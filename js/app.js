// ========================================================
// GAZELA SPINER SENSOR — SENSOR LAB
// app.js
//
// Communication Layer + LIVE diagnostics
//
// USB:
//   PC      -> Web Serial
//   Android -> WebUSB
//
// BLE:
//   PC      -> Web Bluetooth
//   Android -> Web Bluetooth
// ========================================================


// ========================================================
// BLE UUIDs
// ========================================================

const BLE_SENSOR_SERVICE_UUID =
    "7a1e0001-5a9a-4c71-9b3a-47415a5a0001";

const BLE_LIVE_CHARACTERISTIC_UUID =
    "7a1e0002-5a9a-4c71-9b3a-47415a5a0001";

const BLE_CONTROL_SERVICE_UUID =
    "7a1e0010-5a9a-4c71-9b3a-47415a5a0001";

const BLE_COMMAND_CHARACTERISTIC_UUID =
    "7a1e0011-5a9a-4c71-9b3a-47415a5a0001";


// ========================================================
// WEBUSB
// ========================================================

const USB_VENDOR_ID = 0x2341;
const USB_PRODUCT_ID = 0x805A;


// ========================================================
// GLOBAL STATE
// ========================================================

let sensorTransport = null;
let transportType = null;
let selectedTransport = "usb";

let measuring = false;

let currentMovement = 0;
let currentMovementStart = null;

let sessionStartTime = null;
let sessionEndTime = null;

let sampleCount = 0;

// --------------------------------------------------------
// LIVE DIAGNOSTIC COUNTER
// --------------------------------------------------------

let liveSampleCount = 0;
let lastLiveDiagnosticCount = 0;

let lastHeartbeatTime = 0;
let heartbeatMonitor = null;

const HEARTBEAT_TIMEOUT = 3000;


// ========================================================
// DOM
// ========================================================

const statusDot =
    document.getElementById("statusDot");

const statusText =
    document.getElementById("statusText");

const movementValue =
    document.getElementById("movementValue");

const timeValue =
    document.getElementById("timeValue");

const samplesValue =
    document.getElementById("samplesValue");

const axValue =
    document.getElementById("ax");

const ayValue =
    document.getElementById("ay");

const azValue =
    document.getElementById("az");

const gValue =
    document.getElementById("g");

const angleValue =
    document.getElementById("angle");

const gxValue =
    document.getElementById("gx");

const gyValue =
    document.getElementById("gy");

const gzValue =
    document.getElementById("gz");

const angleyValue =
    document.getElementById("angley");

const usbButton =
    document.getElementById("usbButton");

const bleButton =
    document.getElementById("bleButton");

const connectButton =
    document.getElementById("connectButton");

const disconnectButton =
    document.getElementById("disconnectButton");

const startButton =
    document.getElementById("startButton");

const stopButton =
    document.getElementById("stopButton");

const transportStatus =
    document.getElementById("transportStatus");

const measurementStatus =
    document.getElementById("measurementStatus");

const sessionBadge =
    document.getElementById("sessionBadge");

const movementList =
    document.getElementById("movementList");

const serialMonitor =
    document.getElementById("serialMonitor");


// ========================================================
// INITIAL BUTTON STATE
// ========================================================

if (startButton) {
    startButton.disabled = true;
}

if (stopButton) {
    stopButton.disabled = true;
}

if (disconnectButton) {
    disconnectButton.disabled = true;
}


// ========================================================
// STATUS
// ========================================================

function setStatus(text, state = "neutral") {

    if (statusText) {
        statusText.textContent = text;
    }

    if (statusDot) {

        statusDot.className = "status-dot";

        if (state) {
            statusDot.classList.add(state);
        }
    }
}


function setTransportStatus(text) {

    if (transportStatus) {
        transportStatus.textContent = text;
    }
}


// ========================================================
// SERIAL MONITOR
// ========================================================

const SERIAL_MONITOR_MAX_LINES = 500;

function addSerialLine(
    text,
    className = ""
) {

    if (!serialMonitor) {
        return;
    }

    const line =
        document.createElement("div");

    line.textContent = text;

    if (className) {
        line.className = className;
    }

    serialMonitor.appendChild(line);

    while (
        serialMonitor.children.length >
        SERIAL_MONITOR_MAX_LINES
    ) {

        serialMonitor.removeChild(
            serialMonitor.firstElementChild
        );
    }

    serialMonitor.scrollTop =
        serialMonitor.scrollHeight;
}


// ========================================================
// FORMAT NUMBER
// ========================================================

function formatNumber(
    value,
    decimals = 3
) {

    const number =
        Number(value);

    if (!Number.isFinite(number)) {
        return "--";
    }

    return number.toFixed(decimals);
}


// ========================================================
// FORMAT TIME
// ========================================================

function formatTime(milliseconds) {

    if (!Number.isFinite(milliseconds)) {
        return "00:00.000";
    }

    const totalMs =
        Math.max(0, milliseconds);

    const minutes =
        Math.floor(totalMs / 60000);

    const seconds =
        Math.floor(
            (totalMs % 60000) / 1000
        );

    const ms =
        Math.floor(totalMs % 1000);

    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0") +
        "." +
        String(ms).padStart(3, "0")
    );
}


// ========================================================
// TRANSPORT BASE
// ========================================================

class SensorTransport {

    constructor(onLine) {

        this.onLine = onLine;
        this.running = false;
        this.readTask = null;
    }

    async connect() {
        throw new Error(
            "connect() not implemented"
        );
    }

    async send(command) {
        throw new Error(
            "send() not implemented"
        );
    }

    async disconnect() {
        this.running = false;
    }

    get name() {
        return "Unknown";
    }
}


// ========================================================
// WEB SERIAL
// ========================================================

class WebSerialTransport
    extends SensorTransport {

    constructor(onLine) {

        super(onLine);

        this.port = null;
        this.reader = null;
    }

    get name() {
        return "Web Serial";
    }

    async connect() {

        if (!("serial" in navigator)) {

            throw new Error(
                "Web Serial API nie jest dostępne."
            );
        }

        this.port =
            await navigator.serial.requestPort();

        await this.port.open({
            baudRate: 115200
        });

        this.running = true;

        this.readTask =
            this.readLoop();
    }

    async readLoop() {

        try {

            const decoder =
                new TextDecoder();

            this.reader =
                this.port.readable.getReader();

            let buffer = "";

            while (this.running) {

                const {
                    value,
                    done
                } =
                    await this.reader.read();

                if (done) {
                    break;
                }

                if (!value) {
                    continue;
                }

                buffer +=
                    decoder.decode(
                        value,
                        {
                            stream: true
                        }
                    );

                const lines =
                    buffer.split(/\r?\n/);

                buffer =
                    lines.pop() || "";

                for (
                    const line of lines
                ) {

                    const cleanLine =
                        line.trim();

                    if (cleanLine) {
                        this.onLine(cleanLine);
                    }
                }
            }

        }
        catch (error) {

            if (this.running) {

                console.error(
                    "Web Serial read error:",
                    error
                );
            }

        }
        finally {

            if (this.reader) {

                try {
                    this.reader.releaseLock();
                }
                catch (error) {
                    console.warn(error);
                }

                this.reader = null;
            }
        }
    }

    async send(command) {

        if (
            !this.port ||
            !this.port.writable
        ) {

            throw new Error(
                "Web Serial nie jest gotowy do wysyłania."
            );
        }

        const writer =
            this.port.writable.getWriter();

        try {

            await writer.write(
                new TextEncoder().encode(
                    command + "\n"
                )
            );

        }
        finally {

            writer.releaseLock();
        }
    }

    async disconnect() {

        this.running = false;

        if (this.reader) {

            try {
                await this.reader.cancel();
            }
            catch (error) {
                console.warn(error);
            }
        }

        if (this.readTask) {

            try {

                await Promise.race([
                    this.readTask,

                    new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                1000
                            )
                    )
                ]);

            }
            catch (error) {
                console.warn(error);
            }
        }

        if (this.port) {

            try {
                await this.port.close();
            }
            catch (error) {
                console.warn(error);
            }
        }

        this.reader = null;
        this.port = null;
        this.readTask = null;
    }
}


// ========================================================
// WEBUSB
// ========================================================

class WebUSBTransport
    extends SensorTransport {

    constructor(onLine) {

        super(onLine);

        this.device = null;

        this.interface0Claimed = false;
        this.interface1Claimed = false;

        this.decoder =
            new TextDecoder();

        this.encoder =
            new TextEncoder();

        this.buffer = "";
    }

    get name() {
        return "WebUSB";
    }

    async connect() {

        if (!("usb" in navigator)) {

            throw new Error(
                "WebUSB nie jest dostępne."
            );
        }

        const devices =
            await navigator.usb.getDevices();

        this.device =
            devices.find(
                device =>
                    device.vendorId ===
                        USB_VENDOR_ID &&
                    device.productId ===
                        USB_PRODUCT_ID
            );

        if (!this.device) {

            this.device =
                await navigator.usb.requestDevice({

                    filters: [
                        {
                            vendorId:
                                USB_VENDOR_ID,

                            productId:
                                USB_PRODUCT_ID
                        }
                    ]
                });
        }

        await this.device.open();

        if (
            this.device.configuration === null
        ) {

            await this.device.selectConfiguration(1);

        }
        else if (
            this.device.configuration
                .configurationValue !== 1
        ) {

            await this.device.selectConfiguration(1);
        }

        await this.device.claimInterface(0);

        this.interface0Claimed = true;

        const lineCoding =
            new Uint8Array([
                0x00,
                0xC2,
                0x01,
                0x00,
                0x00,
                0x00,
                0x08
            ]);

        await this.device.controlTransferOut(
            {
                requestType: "class",
                recipient: "interface",
                request: 0x20,
                value: 0x0000,
                index: 0x0000
            },
            lineCoding
        );

        await this.device.controlTransferOut(
            {
                requestType: "class",
                recipient: "interface",
                request: 0x22,
                value: 0x0001,
                index: 0x0000
            }
        );

        await this.device.claimInterface(1);

        this.interface1Claimed = true;

        this.running = true;

        this.readTask =
            this.readLoop();
    }

    async readLoop() {

        try {

            while (this.running) {

                const result =
                    await this.device.transferIn(
                        1,
                        64
                    );

                if (
                    !result ||
                    !result.data ||
                    result.data.byteLength === 0
                ) {
                    continue;
                }

                const text =
                    this.decoder.decode(
                        result.data
                    );

                this.buffer += text;

                const lines =
                    this.buffer.split(
                        /\r?\n/
                    );

                this.buffer =
                    lines.pop() || "";

                for (
                    const line of lines
                ) {

                    const cleanLine =
                        line.trim();

                    if (cleanLine) {
                        this.onLine(cleanLine);
                    }
                }
            }

        }
        catch (error) {

            if (this.running) {

                console.error(
                    "WebUSB read error:",
                    error
                );
            }
        }
    }

    async send(command) {

        if (
            !this.device ||
            !this.device.opened ||
            !this.interface1Claimed
        ) {

            throw new Error(
                "WebUSB nie jest gotowy do wysyłania."
            );
        }

        const data =
            this.encoder.encode(
                command + "\n"
            );

        await this.device.transferOut(
            1,
            data
        );
    }

    async disconnect() {

        this.running = false;

        if (this.readTask) {

            try {

                await Promise.race([
                    this.readTask,

                    new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                1200
                            )
                    )
                ]);

            }
            catch (error) {
                console.warn(error);
            }
        }

        if (this.device) {

            if (this.interface1Claimed) {

                try {
                    await this.device.releaseInterface(1);
                }
                catch (error) {
                    console.warn(error);
                }

                this.interface1Claimed = false;
            }

            if (this.interface0Claimed) {

                try {
                    await this.device.releaseInterface(0);
                }
                catch (error) {
                    console.warn(error);
                }

                this.interface0Claimed = false;
            }

            try {
                await this.device.close();
            }
            catch (error) {
                console.warn(error);
            }
        }

        this.device = null;
        this.readTask = null;
        this.buffer = "";
    }
}


// ========================================================
// WEB BLUETOOTH
// ========================================================

class WebBluetoothTransport
    extends SensorTransport {

    constructor(onLine) {

        super(onLine);

        this.device = null;
        this.server = null;

        this.sensorService = null;
        this.liveCharacteristic = null;

        this.controlService = null;
        this.commandCharacteristic = null;

        this.decoder =
            new TextDecoder();

        this.boundNotificationHandler =
            this.handleNotification.bind(this);

        this.boundDisconnectHandler =
            this.handleDisconnected.bind(this);
    }

    get name() {
        return "Web Bluetooth";
    }

    async connect() {

        if (!("bluetooth" in navigator)) {

            throw new Error(
                "Web Bluetooth nie jest dostępny."
            );
        }

        this.device =
            await navigator.bluetooth.requestDevice({

                filters: [
                    {
                        name: "GAZELA SENSOR"
                    }
                ],

                optionalServices: [
                    BLE_SENSOR_SERVICE_UUID,
                    BLE_CONTROL_SERVICE_UUID
                ]
            });

        this.device.addEventListener(
            "gattserverdisconnected",
            this.boundDisconnectHandler
        );

        this.server =
            await this.device.gatt.connect();

        this.sensorService =
            await this.server.getPrimaryService(
                BLE_SENSOR_SERVICE_UUID
            );

        this.liveCharacteristic =
            await this.sensorService.getCharacteristic(
                BLE_LIVE_CHARACTERISTIC_UUID
            );

        this.controlService =
            await this.server.getPrimaryService(
                BLE_CONTROL_SERVICE_UUID
            );

        this.commandCharacteristic =
            await this.controlService.getCharacteristic(
                BLE_COMMAND_CHARACTERISTIC_UUID
            );

        await this.liveCharacteristic.startNotifications();

        this.liveCharacteristic.addEventListener(
            "characteristicvaluechanged",
            this.boundNotificationHandler
        );

        this.running = true;
    }

    handleNotification(event) {

        try {

            const value =
                event.target.value;

            const text =
                this.decoder.decode(value);

            const lines =
                text.split(/\r?\n/);

            for (
                const line of lines
            ) {

                const cleanLine =
                    line.trim();

                if (cleanLine) {
                    this.onLine(cleanLine);
                }
            }

        }
        catch (error) {

            console.error(
                "BLE notification error:",
                error
            );
        }
    }

    async send(command) {

        if (
            !this.commandCharacteristic
        ) {

            throw new Error(
                "BLE command characteristic nie jest gotowa."
            );
        }

        // BLE v5:
        // wysyłamy "L" lub "Q"
        // bez \n

        const data =
            new TextEncoder().encode(
                command
            );

        await this.commandCharacteristic.writeValue(
            data
        );
    }

    async disconnect() {

        this.running = false;

        if (this.liveCharacteristic) {

            try {
                await this.liveCharacteristic.stopNotifications();
            }
            catch (error) {
                console.warn(error);
            }

            try {

                this.liveCharacteristic.removeEventListener(
                    "characteristicvaluechanged",
                    this.boundNotificationHandler
                );

            }
            catch (error) {
                console.warn(error);
            }
        }

        if (
            this.device &&
            this.device.gatt &&
            this.device.gatt.connected
        ) {

            try {
                this.device.gatt.disconnect();
            }
            catch (error) {
                console.warn(error);
            }
        }

        if (this.device) {

            try {

                this.device.removeEventListener(
                    "gattserverdisconnected",
                    this.boundDisconnectHandler
                );

            }
            catch (error) {
                console.warn(error);
            }
        }

        this.device = null;
        this.server = null;
        this.sensorService = null;
        this.liveCharacteristic = null;
        this.controlService = null;
        this.commandCharacteristic = null;
    }

    handleDisconnected() {

        this.running = false;

        addSerialLine(
            "BLE device disconnected.",
            "serial-error"
        );

        if (
            sensorTransport === this
        ) {

            sensorTransport = null;
            transportType = null;

            stopHeartbeatMonitor();

            measuring = false;

            if (connectButton) {
                connectButton.disabled = false;
            }

            if (disconnectButton) {
                disconnectButton.disabled = true;
            }

            if (startButton) {
                startButton.disabled = true;
            }

            if (stopButton) {
                stopButton.disabled = true;
            }

            setStatus(
                "Sensor disconnected",
                "neutral"
            );

            setTransportStatus(
                "Transport: not connected"
            );

            if (measurementStatus) {

                measurementStatus.textContent =
                    "Sensor disconnected.";

                measurementStatus.className =
                    "measurement-status";
            }
        }
    }
}


// ========================================================
// TRANSPORT FACTORY
// ========================================================

async function createSensorTransport() {

    if (
        selectedTransport === "usb"
    ) {

        const isAndroid =
            /Android/i.test(
                navigator.userAgent
            );

        if (
            isAndroid &&
            "usb" in navigator
        ) {

            return new WebUSBTransport(
                processSerialLine
            );
        }

        if (
            "serial" in navigator
        ) {

            return new WebSerialTransport(
                processSerialLine
            );
        }

        if (
            "usb" in navigator
        ) {

            return new WebUSBTransport(
                processSerialLine
            );
        }

        throw new Error(
            "Brak Web Serial oraz WebUSB."
        );
    }

    if (
        selectedTransport === "ble"
    ) {

        if (
            "bluetooth" in navigator
        ) {

            return new WebBluetoothTransport(
                processSerialLine
            );
        }

        throw new Error(
            "Web Bluetooth nie jest dostępny."
        );
    }

    throw new Error(
        "Nieznany transport."
    );
}


// ========================================================
// HEARTBEAT
// ========================================================

function startHeartbeatMonitor() {

    stopHeartbeatMonitor();

    lastHeartbeatTime =
        Date.now();

    heartbeatMonitor =
        setInterval(
            () => {

                if (!sensorTransport) {
                    return;
                }

                const elapsed =
                    Date.now() -
                    lastHeartbeatTime;

                if (
                    elapsed >
                    HEARTBEAT_TIMEOUT
                ) {

                    if (!measuring) {

                        setStatus(
                            "No sensor data",
                            "error"
                        );
                    }
                }

            },
            500
        );
}


function stopHeartbeatMonitor() {

    if (heartbeatMonitor) {

        clearInterval(
            heartbeatMonitor
        );

        heartbeatMonitor = null;
    }
}


// ========================================================
// RESET LIVE
// ========================================================

function resetLiveValues() {

    liveSampleCount = 0;
    lastLiveDiagnosticCount = 0;

    if (movementValue) {
        movementValue.textContent = "--";
    }

    if (timeValue) {
        timeValue.textContent = "--";
    }

    if (samplesValue) {
        samplesValue.textContent = "0";
    }

    if (axValue) {
        axValue.textContent = "--";
    }

    if (ayValue) {
        ayValue.textContent = "--";
    }

    if (azValue) {
        azValue.textContent = "--";
    }

    if (gValue) {
        gValue.textContent = "--";
    }

    if (angleValue) {
        angleValue.textContent = "--";
    }

    if (gxValue) {
        gxValue.textContent = "--";
    }

    if (gyValue) {
        gyValue.textContent = "--";
    }

    if (gzValue) {
        gzValue.textContent = "--";
    }

    if (angleyValue) {
        angleyValue.textContent = "--";
    }
}


// ========================================================
// PARSE LIVE DATA
// ========================================================

function parseLiveData(line) {

    const parts =
        line.split(",");

    if (parts.length < 10) {
        return;
    }

    if (parts[0] !== "LIVE") {
        return;
    }

    const AX =
        parseFloat(parts[1]);

    const AY =
        parseFloat(parts[2]);

    const AZ =
        parseFloat(parts[3]);

    const G =
        parseFloat(parts[4]);

    const Angle =
        parseFloat(parts[5]);

    const GX =
        parseFloat(parts[6]);

    const GY =
        parseFloat(parts[7]);

    const GZ =
        parseFloat(parts[8]);

    const AngleY =
        parseFloat(parts[9]);


    // ====================================================
    // DIAGNOSTIC COUNTER
    // ====================================================

    liveSampleCount++;

    if (samplesValue) {

        samplesValue.textContent =
            liveSampleCount;
    }

    // Co 50 ramek pokazujemy tylko jeden wpis.

    if (
        liveSampleCount -
        lastLiveDiagnosticCount >= 50
    ) {

        lastLiveDiagnosticCount =
            liveSampleCount;

        addSerialLine(
            "LIVE DATA RECEIVED: " +
            liveSampleCount,
            "serial-info"
        );
    }


    // ====================================================
    // LIVE SENSOR VALUES
    // ====================================================

    if (axValue) {

        axValue.textContent =
            formatNumber(AX);
    }

    if (ayValue) {

        ayValue.textContent =
            formatNumber(AY);
    }

    if (azValue) {

        azValue.textContent =
            formatNumber(AZ);
    }

    if (gValue) {

        gValue.textContent =
            formatNumber(G);
    }

    if (angleValue) {

        angleValue.textContent =
            formatNumber(
                Angle,
                1
            );
    }

    if (gxValue) {

        gxValue.textContent =
            formatNumber(GX);
    }

    if (gyValue) {

        gyValue.textContent =
            formatNumber(GY);
    }

    if (gzValue) {

        gzValue.textContent =
            formatNumber(GZ);
    }

    if (angleyValue) {

        angleyValue.textContent =
            formatNumber(
                AngleY,
                1
            );
    }


    // LIVE = communication confirmed

    lastHeartbeatTime =
        Date.now();
}


// ========================================================
// PROCESS SENSOR LINE
// ========================================================

function processSerialLine(line) {

    if (!line) {
        return;
    }


    // ----------------------------------------------------
    // LIVE DATA
    //
    // We deliberately handle it before adding it
    // to Serial Monitor.
    // ----------------------------------------------------

    if (
        line.startsWith("LIVE,")
    ) {

        parseLiveData(line);

        return;
    }


    // ----------------------------------------------------
    // ALL OTHER LINES
    // ----------------------------------------------------

    addSerialLine(line);


    // ----------------------------------------------------
    // HEARTBEAT
    // ----------------------------------------------------

    if (
        line === "HEARTBEAT"
    ) {

        lastHeartbeatTime =
            Date.now();

        if (!measuring) {

            setStatus(
                "Sensor ready",
                "connected"
            );
        }

        return;
    }


    // ----------------------------------------------------
    // READY
    // ----------------------------------------------------

    if (
        line === "READY"
    ) {

        measuring = false;

        lastHeartbeatTime =
            Date.now();

        setStatus(
            "Sensor ready",
            "connected"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Sensor ready.";

            measurementStatus.className =
                "measurement-status";
        }

        if (startButton) {
            startButton.disabled = false;
        }

        if (stopButton) {
            stopButton.disabled = true;
        }

        return;
    }


    // ----------------------------------------------------
    // LIVE MODE
    // ----------------------------------------------------

    if (
        line === "INFO,LIVE_MODE" ||
        line === "INFO,LIVE_START"
    ) {

        measuring = false;

        setStatus(
            "Live sensor",
            "connected"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Live sensor mode active.";

            measurementStatus.className =
                "measurement-status active";
        }

        if (startButton) {
            startButton.disabled = false;
        }

        if (stopButton) {
            stopButton.disabled = true;
        }

        return;
    }


    // ----------------------------------------------------
    // LIVE STOP
    // ----------------------------------------------------

    if (
        line === "INFO,LIVE_STOP"
    ) {

        return;
    }


    // ----------------------------------------------------
    // MEASUREMENT START
    // ----------------------------------------------------

    if (
        line === "INFO,START"
    ) {

        measuring = true;

        sessionStartTime =
            Date.now();

        sessionEndTime = null;

        sampleCount = 0;
        currentMovement = 0;

        if (sessionBadge) {
            sessionBadge.textContent =
                "Measurement";
        }

        setStatus(
            "Measurement running",
            "connected"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Measurement running.";

            measurementStatus.className =
                "measurement-status active";
        }

        if (startButton) {
            startButton.disabled = true;
        }

        if (stopButton) {
            stopButton.disabled = false;
        }

        return;
    }


    // ----------------------------------------------------
    // PREPARE
    // ----------------------------------------------------

    if (
        line === "INFO,PREPARE"
    ) {

        if (measurementStatus) {

            measurementStatus.textContent =
                "Preparing measurement...";

            measurementStatus.className =
                "measurement-status active";
        }

        return;
    }


    // ----------------------------------------------------
    // COUNTDOWN
    // ----------------------------------------------------

    if (
        line.startsWith(
            "COUNTDOWN,"
        )
    ) {

        const value =
            line.split(",")[1];

        if (measurementStatus) {

            measurementStatus.textContent =
                "Countdown: " +
                value;
        }

        return;
    }


    // ----------------------------------------------------
    // MOVEMENT
    // ----------------------------------------------------

    if (
        line.startsWith(
            "MOVEMENT,"
        )
    ) {

        const parts =
            line.split(",");

        if (parts.length >= 2) {

            currentMovement =
                parseInt(
                    parts[1],
                    10
                );
        }

        if (movementValue) {

            movementValue.textContent =
                currentMovement;
        }

        return;
    }


    // ----------------------------------------------------
    // CSV HEADER
    // ----------------------------------------------------

    if (
        line.startsWith(
            "MOVEMENT,TIME_ms"
        )
    ) {

        return;
    }


    // ----------------------------------------------------
    // CSV SAMPLE
    // ----------------------------------------------------

    if (
        /^\d+,/.test(line)
    ) {

        sampleCount++;

        if (samplesValue) {

            samplesValue.textContent =
                sampleCount;
        }

        const parts =
            line.split(",");

        if (parts.length >= 11) {

            const movement =
                parseInt(
                    parts[0],
                    10
                );

            const time =
                parseInt(
                    parts[1],
                    10
                );

            const AX =
                parseFloat(parts[2]);

            const AY =
                parseFloat(parts[3]);

            const AZ =
                parseFloat(parts[4]);

            const G =
                parseFloat(parts[5]);

            const Angle =
                parseFloat(parts[6]);

            const GX =
                parseFloat(parts[7]);

            const GY =
                parseFloat(parts[8]);

            const GZ =
                parseFloat(parts[9]);

            const AngleY =
                parseFloat(parts[10]);


            if (movementValue) {

                movementValue.textContent =
                    movement;
            }

            if (timeValue) {

                timeValue.textContent =
                    formatTime(time);
            }

            if (axValue) {
                axValue.textContent =
                    formatNumber(AX);
            }

            if (ayValue) {
                ayValue.textContent =
                    formatNumber(AY);
            }

            if (azValue) {
                azValue.textContent =
                    formatNumber(AZ);
            }

            if (gValue) {
                gValue.textContent =
                    formatNumber(G);
            }

            if (angleValue) {
                angleValue.textContent =
                    formatNumber(
                        Angle,
                        1
                    );
            }

            if (gxValue) {
                gxValue.textContent =
                    formatNumber(GX);
            }

            if (gyValue) {
                gyValue.textContent =
                    formatNumber(GY);
            }

            if (gzValue) {
                gzValue.textContent =
                    formatNumber(GZ);
            }

            if (angleyValue) {
                angleyValue.textContent =
                    formatNumber(
                        AngleY,
                        1
                    );
            }
        }

        return;
    }


    // ----------------------------------------------------
    // END
    // ----------------------------------------------------

    if (
        line === "END,ALL_MOVEMENTS"
    ) {

        finishSession();

        return;
    }
}


// ========================================================
// SEND COMMAND
// ========================================================

async function sendCommand(command) {

    if (!sensorTransport) {

        throw new Error(
            "Sensor nie jest podłączony."
        );
    }

    try {

        await sensorTransport.send(
            command
        );

        addSerialLine(
            "> " + command,
            "serial-command"
        );

    }
    catch (error) {

        console.error(
            "Send command error:",
            error
        );

        addSerialLine(
            "SEND ERROR: " +
            error.message,
            "serial-error"
        );

        throw error;
    }
}


// ========================================================
// START LIVE
// ========================================================

async function startLiveMode() {

    if (!sensorTransport) {
        return;
    }

    try {

        await sendCommand("L");

        measuring = false;

        liveSampleCount = 0;
        lastLiveDiagnosticCount = 0;

        lastHeartbeatTime =
            Date.now();

        setStatus(
            "Live sensor",
            "connected"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Live sensor mode active.";

            measurementStatus.className =
                "measurement-status active";
        }

        if (startButton) {
            startButton.disabled = false;
        }

        if (stopButton) {
            stopButton.disabled = true;
        }

    }
    catch (error) {

        console.error(error);

        setStatus(
            "Live mode error",
            "error"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Unable to start LIVE mode.";

            measurementStatus.className =
                "measurement-status";
        }

        addSerialLine(
            "LIVE ERROR: " +
            error.message,
            "serial-error"
        );
    }
}


// ========================================================
// CONNECT SENSOR
// ========================================================

async function connectSensor() {

    if (sensorTransport) {
        return;
    }

    try {

        sensorTransport =
            await createSensorTransport();

        transportType =
            sensorTransport.name;

        setTransportStatus(
            "Transport: " +
            transportType
        );

        await sensorTransport.connect();

        if (connectButton) {
            connectButton.disabled = true;
        }

        if (disconnectButton) {
            disconnectButton.disabled = false;
        }

        setStatus(
            "Sensor connected",
            "connected"
        );

        addSerialLine(
            "Transport connected: " +
            transportType,
            "serial-info"
        );

        resetLiveValues();

        startHeartbeatMonitor();

        // Start LIVE after connection.

        setTimeout(
            () => {

                if (sensorTransport) {
                    startLiveMode();
                }

            },
            300
        );

    }
    catch (error) {

        console.error(
            "Connection error:",
            error
        );

        if (sensorTransport) {

            try {
                await sensorTransport.disconnect();
            }
            catch (disconnectError) {
                console.warn(
                    disconnectError
                );
            }
        }

        sensorTransport = null;
        transportType = null;

        setTransportStatus(
            "Transport: not connected"
        );

        setStatus(
            "Connection failed",
            "error"
        );

        addSerialLine(
            "CONNECT ERROR: " +
            error.message,
            "serial-error"
        );

        if (connectButton) {
            connectButton.disabled = false;
        }

        if (disconnectButton) {
            disconnectButton.disabled = true;
        }
    }
}


// ========================================================
// START MEASUREMENT
// ========================================================

async function startMeasurement() {

    if (!sensorTransport) {
        return;
    }

    // BLE v5 currently supports LIVE only.

    if (
        selectedTransport === "ble"
    ) {

        setStatus(
            "BLE measurement not available yet",
            "error"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "BLE currently supports LIVE only.";

            measurementStatus.className =
                "measurement-status";
        }

        addSerialLine(
            "BLE: command S is not implemented in BLE firmware v5.",
            "serial-info"
        );

        return;
    }


    // USB measurement

    try {

        measuring = true;

        sampleCount = 0;
        currentMovement = 0;

        sessionStartTime =
            Date.now();

        sessionEndTime = null;

        if (samplesValue) {
            samplesValue.textContent = "0";
        }

        if (movementValue) {
            movementValue.textContent = "--";
        }

        if (timeValue) {
            timeValue.textContent = "--";
        }

        if (movementList) {
            movementList.innerHTML = "";
        }

        if (sessionBadge) {
            sessionBadge.textContent =
                "Measurement";
        }

        setStatus(
            "Measurement starting",
            "connected"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Starting measurement...";

            measurementStatus.className =
                "measurement-status active";
        }

        if (startButton) {
            startButton.disabled = true;
        }

        if (stopButton) {
            stopButton.disabled = false;
        }

        await sendCommand("S");

    }
    catch (error) {

        console.error(error);

        measuring = false;

        setStatus(
            "Measurement error",
            "error"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Unable to start measurement.";

            measurementStatus.className =
                "measurement-status";
        }

        if (startButton) {
            startButton.disabled = false;
        }

        if (stopButton) {
            stopButton.disabled = true;
        }
    }
}


// ========================================================
// FINISH SESSION
// ========================================================

function finishSession() {

    measuring = false;

    sessionEndTime =
        Date.now();

    if (sessionBadge) {

        sessionBadge.textContent =
            "Session complete";
    }

    setStatus(
        "Measurement complete",
        "connected"
    );

    if (measurementStatus) {

        measurementStatus.textContent =
            "Five movements completed.";

        measurementStatus.className =
            "measurement-status";
    }

    if (startButton) {
        startButton.disabled = false;
    }

    if (stopButton) {
        stopButton.disabled = true;
    }

    setTimeout(
        () => {

            if (sensorTransport) {
                startLiveMode();
            }

        },
        300
    );
}


// ========================================================
// STOP
// ========================================================

async function stopMeasurement() {

    if (!sensorTransport) {
        return;
    }

    try {

        measuring = false;

        await sendCommand("Q");

        if (measurementStatus) {

            measurementStatus.textContent =
                "Stopping...";
        }

    }
    catch (error) {

        console.error(
            "Stop error:",
            error
        );
    }
}


// ========================================================
// DISCONNECT
// ========================================================

async function disconnectSensor() {

    stopHeartbeatMonitor();

    const transport =
        sensorTransport;

    sensorTransport = null;
    transportType = null;

    try {

        if (transport) {

            try {

                await transport.send("Q");

                addSerialLine(
                    "> Q",
                    "serial-command"
                );

            }
            catch (error) {

                console.warn(
                    "Unable to send Q:",
                    error
                );
            }

            await transport.disconnect();
        }

    }
    catch (error) {

        console.warn(
            "Disconnect error:",
            error
        );

    }
    finally {

        measuring = false;

        if (connectButton) {
            connectButton.disabled = false;
        }

        if (disconnectButton) {
            disconnectButton.disabled = true;
        }

        if (startButton) {
            startButton.disabled = true;
        }

        if (stopButton) {
            stopButton.disabled = true;
        }

        setStatus(
            "Sensor not connected",
            "neutral"
        );

        setTransportStatus(
            "Transport: not connected"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Sensor disconnected.";

            measurementStatus.className =
                "measurement-status";
        }

        addSerialLine(
            "Sensor disconnected.",
            "serial-info"
        );
    }
}


// ========================================================
// SELECT USB
// ========================================================

function selectUSBTransport() {

    if (sensorTransport) {
        return;
    }

    selectedTransport = "usb";

    if (usbButton) {
        usbButton.classList.add("active");
    }

    if (bleButton) {
        bleButton.classList.remove("active");
    }

    setTransportStatus(
        "Transport: USB"
    );

    addSerialLine(
        "Selected transport: USB",
        "serial-info"
    );
}


// ========================================================
// SELECT BLE
// ========================================================

function selectBLETransport() {

    if (sensorTransport) {
        return;
    }

    selectedTransport = "ble";

    if (bleButton) {
        bleButton.classList.add("active");
    }

    if (usbButton) {
        usbButton.classList.remove("active");
    }

    setTransportStatus(
        "Transport: BLE"
    );

    addSerialLine(
        "Selected transport: BLE",
        "serial-info"
    );
}


// ========================================================
// EVENTS
// ========================================================

if (usbButton) {

    usbButton.addEventListener(
        "click",
        selectUSBTransport
    );
}

if (bleButton) {

    bleButton.addEventListener(
        "click",
        selectBLETransport
    );
}

if (connectButton) {

    connectButton.addEventListener(
        "click",
        connectSensor
    );
}

if (disconnectButton) {

    disconnectButton.addEventListener(
        "click",
        disconnectSensor
    );
}

if (startButton) {

    startButton.addEventListener(
        "click",
        startMeasurement
    );
}

if (stopButton) {

    stopButton.addEventListener(
        "click",
        stopMeasurement
    );
}


// ========================================================
// INITIAL STATE
// ========================================================

selectUSBTransport();

setStatus(
    "Sensor not connected",
    "neutral"
);

setTransportStatus(
    "Transport: USB"
);

resetLiveValues();


// ========================================================
// DEBUG
// ========================================================

window.gazelaSensor = {

    getTransport: () =>
        sensorTransport,

    getTransportType: () =>
        transportType,

    getSelectedTransport: () =>
        selectedTransport,

    getLiveSampleCount: () =>
        liveSampleCount,

    send: sendCommand
};


// ========================================================
// END
// ========================================================
