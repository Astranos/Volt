// library loaded from package https://www.npmjs.com/package/@undecaf/zbar-wasm
// look at zbar wiki: https://github.com/samsam2310/zbar.wasm/wiki
// also you can be interesting with https://zbar-wasm.github.io/demo/

// interval between scanning
const SCAN_PROID_MS = 100;

var zbarWasm;

const sleep = (ms) =>
    new Promise((r) => {
        setTimeout(r, ms);
    });

var ZBarConnector = {
    targetElementId: "upc-stream",
    videoElement: null,
    canvasElement: null,
    scanner: null,

    init: async () => {
        const targetElement = document.getElementById(
            ZBarConnector.targetElementId
        );

        ZBarConnector.videoElement = document.createElement("video");
        ZBarConnector.canvasElement = document.createElement("canvas");
        ZBarConnector.canvasElement.setAttribute("class", "drawingBuffer");

        targetElement.appendChild(ZBarConnector.videoElement);
        targetElement.appendChild(ZBarConnector.canvasElement);

        const mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: "environment", // or user
                aspectRatio: { min: 1, max: 2, ideal: 1 }, // prevent wide lens
                width: { min: 640 },
                height: { min: 480 },
            },
        });
        ZBarConnector.videoElement.srcObject = mediaStream;
        ZBarConnector.videoElement.setAttribute("playsinline", "");
        ZBarConnector.videoElement.play();
        await new Promise((r) => {
            ZBarConnector.videoElement.onloadedmetadata = r;
        });

        ZBarConnector.scanner = await zbarWasm.getDefaultScanner();
        ZBarConnector.scanner.setConfig(
            zbarWasm.ZBarSymbolType.ZBAR_NONE,
            zbarWasm.ZBarConfigType.ZBAR_CFG_ENABLE,
            0
        );

        // you can enumerate additional required types of codes
        ZBarConnector.scanner.setConfig(
            zbarWasm.ZBarSymbolType.ZBAR_UPCA,
            zbarWasm.ZBarConfigType.ZBAR_CFG_ENABLE,
            1
        );
        ZBarConnector.scanner.setConfig(
            zbarWasm.ZBarSymbolType.ZBAR_UPCE,
            zbarWasm.ZBarConfigType.ZBAR_CFG_ENABLE,
            1
        );
        ZBarConnector.scanner.setConfig(
            zbarWasm.ZBarSymbolType.ZBAR_EAN13,
            zbarWasm.ZBarConfigType.ZBAR_CFG_ENABLE,
            1
        );
    },

    clear: () => {
        ZBarConnector.videoElement.remove();
        ZBarConnector.canvasElement.remove();
    },

    render: (symbols) => {
        const ctx = ZBarConnector.canvasElement.getContext("2d");
        const width = ZBarConnector.canvasElement.width;
        const height = ZBarConnector.canvasElement.height;
        ctx.clearRect(0, 0, width, height);
        ctx.font = "20px serif";
        ctx.strokeStyle = "#00ff00";
        ctx.fillStyle = "#ffff00";
        ctx.lineWidth = 6;
        for (let i = 0; i < symbols.length; ++i) {
            const sym = symbols[i];
            const points = sym.points;
            ctx.beginPath();
            for (let j = 0; j < points.length; ++j) {
                const { x, y } = points[j];
                if (j === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.closePath();
            ctx.stroke();
        }
    },
    scan: async (onSuccess) => {
        const width = ZBarConnector.videoElement.videoWidth;
        const height = ZBarConnector.videoElement.videoHeight;
        ZBarConnector.canvasElement.width = width;
        ZBarConnector.canvasElement.height = height;
        const ctx = ZBarConnector.canvasElement.getContext("2d");
        ctx.willReadFrequently = true;
        ctx.drawImage(ZBarConnector.videoElement, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height);
        const res = await zbarWasm.scanImageData(
            imgData,
            ZBarConnector.scanner
        );
        if (res.length > 0) {
            ZBarConnector.render(res);
            return onSuccess(res);
        }
        return false;
    },

    start: async (onSuccess) => {
        try {
            await ZBarConnector.init();
            while (true) {
                if (await ZBarConnector.scan(onSuccess)) {
                    return true;
                }
                await sleep(SCAN_PROID_MS);
            }
        } catch (err) {
            console.error(err);
            return false;
        }
    },
};
