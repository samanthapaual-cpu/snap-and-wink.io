//Frames (slots is optional: the number of photo areas, used by the filter chips)
const FRAMES = [
    {name:"1", src:"assets/frames/pink.png"},
    {name:"2", src:"assets/frames/barbie.png"},
    {name:"3", src:"assets/frames/8.png"},
    {name:"4", src:"assets/frames/4.png"},
    {name:"5", src:"assets/frames/5.png"},
    {name:"6", src:"assets/frames/6.png"}
];

//Elements
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const overlay = document.querySelector(".overlay");
const flash = document.querySelector(".flash");
const statusElement = document.getElementById("status");

const captureBtn = document.getElementById("capture-btn");
const retakeBtn = document.getElementById("retake-btn");
const filterBtn = document.getElementById("filter-btn");
const mirrorBtn = document.getElementById("mirror-btn");

const timerInput = document.getElementById("timer");

const frames = document.getElementById("frames");

const resultBox = document.getElementById("result-box");
const resultCanvas = document.getElementById("result");

//Filters
const filters = [
    ["None", "none"],
    ["B&W", "grayscale(100%)"],
    ["Vintage", "sepia(100%)"],
    ["Bright", "brightness(120%)"]
];

let filterIndex = 0;
let mirror = true;
let busy = false;

let frameImage = null;
let slots = [];
let photos = [];

//Helper Functions
function wait(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

function showStatus(message) {
    statusElement.textContent = message;
}

function showOverlay(text, small = false) {
    overlay.textContent = text;
    overlay.classList.toggle("small", small);
}

//Detect Photo Slots in the frame
function detectSlots(image) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;

    const tempContext = tempCanvas.getContext("2d");
    tempContext.drawImage(image, 0, 0);

    const pixels = tempContext.getImageData(0, 0, width, height).data;

    const seen = new Uint8Array(width * height);
    const stack = new Int32Array(width * height);

    const minimumArea = width * height * 0.005;
    const foundSlots = [];

    let stackPosition = 0;

    function addPixel(pixel) {
        if (!seen[pixel] && pixels[pixel * 4 + 3] <= 10) {
            seen[pixel] = 1;
            stack[stackPosition] = pixel;
            stackPosition++;
        }
    }

    for (let start = 0; start < width * height; start++) {
        if (seen[start] || pixels[start * 4 + 3] > 10) {
            continue;
        }

        let area = 0;
        let left = width;
        let top = height;
        let right = 0;
        let bottom = 0;

        addPixel(start);

        while (stackPosition > 0) {
            stackPosition--;

            const pixel = stack[stackPosition];
            const x = pixel % width;
            const y = Math.floor(pixel / width);

            area++;

            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;

            if (x > 0) addPixel(pixel - 1);
            if (x < width - 1) addPixel(pixel + 1);
            if (y > 0) addPixel(pixel - width);
            if (y < height - 1) addPixel(pixel + width);
        }

        if (area >= minimumArea) {
            foundSlots.push({
                x: left,
                y: top,
                w: right - left + 1,
                h: bottom - top + 1
            });
        }
    }

    //Sort slots from top to bottom, and left to right
    foundSlots.sort((a, b) => {
        const sameRow = Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2;

        if (sameRow) {
            return a.x - b.x;
        }

        return a.y - b.y;
    });

    return foundSlots;
}

//Load Frame Image
function loadImage(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = source;
    });
}

//Select frame
async function selectFrame(frame, button) {
    if (busy) {
        return;
    }

    frames.querySelectorAll("button").forEach(item => {
        item.classList.remove("on");
    });

    button.classList.add("on");

    try {
        frameImage = await loadImage(frame.src);
    }
    catch {
        showStatus(`Could not load ${frame.src}. Check the file path.`);
        return;
    }

    slots = detectSlots(frameImage);

    resetBooth();

    captureBtn.disabled = slots.length === 0;
    retakeBtn.disabled = true;

    if (slots.length > 0) {
        const word = slots.length === 1 ? "slot" : "slots";
        showStatus(`${slots.length} photo ${word} found. Press Capture.`);
    } else {
        showStatus("No transparent photo areas found in this frame.");
    }
}

//Create frame buttons
FRAMES.forEach((frame, index) => {
    const button = document.createElement("button");

    button.innerHTML = `
        <img src="${frame.src}" alt="" loading="lazy">
        <span>${frame.name}</span>
    `;

    button.onclick = () => {
        selectFrame(frame, button);
    };

    frames.appendChild(button);

    if (index === 0) {
        selectFrame(frame, button);
    }
});

//Camera
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {

    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    })

    .then(stream => {
        video.srcObject = stream;

        video.onloadedmetadata = () => {
            video.play();
            updateCamera();
        };
    })

    .catch(() => {
        showStatus("Camera unavailable. Allow camera access in your browser, then reload.");
    });

} else {
    showStatus("The camera needs https or localhost.");
}

//Keep the live preview and captured poses the same size for every frame.
//The finished strip is still rendered at the selected frame's native size.
function sizeCanvas() {
    const width = 800;
    const height = 600;

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
}

//Draw camera video
function drawVideo() {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    const width = canvas.width;
    const height = canvas.height;

    const scale = Math.min(videoWidth / width, videoHeight / height);

    const sourceWidth = width * scale;
    const sourceHeight = height * scale;

    ctx.save();

    if (mirror) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
    }

    ctx.filter = filters[filterIndex][1];

    ctx.drawImage(
        video,
        (videoWidth - sourceWidth) / 2,
        (videoHeight - sourceHeight) / 2,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height
    );

    ctx.restore();
}

//Camera preview loop
function updateCamera() {
    if (video.videoWidth && slots.length) {
        drawVideo();
    }

    requestAnimationFrame(updateCamera);
}

//Reset the current round and dismiss any open result dialog.
function resetBooth() {
    photos = [];

    if (resultBox.open) {
        resultBox.close();
    }

    if (slots.length) {
        sizeCanvas();
    }
}

//Disable controls
function setControls(disabled) {
    captureBtn.disabled = disabled;
    retakeBtn.disabled = disabled;
    filterBtn.disabled = disabled;
    mirrorBtn.disabled = disabled;
    timerInput.disabled = disabled;
}

//Save current camera image
function takePhoto() {
    const photo = document.createElement("canvas");

    photo.width = canvas.width;
    photo.height = canvas.height;

    photo.getContext("2d").drawImage(canvas, 0, 0);

    return photo;
}

//Capture button
captureBtn.onclick = async () => {

    if (busy || !slots.length || !video.videoWidth) {
        return;
    }

    busy = true;

    setControls(true);
    resetBooth();

    const countdown = Math.max(0, Number(timerInput.value) || 0);

    for (let i = 0; i < slots.length; i++) {

        sizeCanvas();

        showStatus(`Pose ${i + 1} of ${slots.length}: get ready`);

        //Countdown
        for (let time = countdown; time > 0; time--) {
            showOverlay(time);
            await wait(1000);
        }

        showOverlay("");

        //Take photo
        photos.push(takePhoto());

        //Flash
        flash.classList.remove("go");
        void flash.offsetWidth;
        flash.classList.add("go");

    }

    //Create final photo, then go back to the live preview
    compose();
    sizeCanvas();

    resultBox.showModal();

    showStatus("All done! Download your photo or retake.");

    busy = false;
    setControls(false);
};

document.getElementById("close-result-btn").onclick = () => {
    resultBox.close();
};

//Create final photo
function compose() {

    resultCanvas.width = frameImage.naturalWidth;
    resultCanvas.height = frameImage.naturalHeight;

    const resultContext = resultCanvas.getContext("2d");

    slots.forEach((slot, index) => {
        const photo = photos[index];
        const photoRatio = photo.width / photo.height;
        const slotRatio = slot.w / slot.h;

        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = photo.width;
        let sourceHeight = photo.height;

        // Crop to fill the frame opening without distorting the photo.
        if (photoRatio > slotRatio) {
            sourceWidth = photo.height * slotRatio;
            sourceX = (photo.width - sourceWidth) / 2;
        } else {
            sourceHeight = photo.width / slotRatio;
            sourceY = (photo.height - sourceHeight) / 2;
        }

        resultContext.drawImage(
            photo,
            sourceX, sourceY, sourceWidth, sourceHeight,
            slot.x, slot.y, slot.w, slot.h
        );
    });

    resultContext.drawImage(frameImage, 0, 0);
}

//Download
document.getElementById("download-btn").onclick = () => {

    resultCanvas.toBlob(blob => {

        const link = document.createElement("a");

        link.href = URL.createObjectURL(blob);
        link.download = "photobooth.png";
        link.click();

        setTimeout(() => {
            URL.revokeObjectURL(link.href);
        }, 1000);

    }, "image/png");
};

//Retake (starts a new round right away)
retakeBtn.onclick = () => {
    captureBtn.click();
};

//Filter
filterBtn.onclick = () => {

    filterIndex++;

    if (filterIndex >= filters.length) {
        filterIndex = 0;
    }

    filterBtn.textContent = `Filter: ${filters[filterIndex][0]}`;
};

//Mirror
mirrorBtn.onclick = () => {

    mirror = !mirror;

    mirrorBtn.textContent = `Mirror: ${mirror ? "On" : "Off"}`;
};
