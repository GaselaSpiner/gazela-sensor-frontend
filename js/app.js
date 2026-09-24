// ============================================================
// GAZELA SPINER SENSOR
// Sensor Lab - app.js
// Unified USB / BLE frontend
// Firmware: v19
// ============================================================


// ============================================================
// BLE
// ============================================================

const BLE_SENSOR_SERVICE_UUID =
    "7a1e0001-5a9a-4c71-9b3a-47415a5a0001";

const BLE_LIVE_CHARACTERISTIC_UUID =
    "7a1e0002-5a9a-4c71-9b3a-47415a5a0001";

const BLE_CONTROL_SERVICE_UUID =
    "7a1e0010-5a9a-4c71-9b3a-47415a5a0001";

const BLE_COMMAND_CHARACTERISTIC_UUID =
    "7a1e0011-5a9a-4c71-9b3a-47415a5a0001";


// ============================================================
// USB
// ============================================================

const USB_VENDOR_ID = 0x2341;
const USB_PRODUCT_ID = 0x805A;


// ============================================================
// GLOBAL STATE
// ============================================================

let sensorTransport = null;

let transportType = null;
let selectedTransport = "USB";

let measuring = false;
let currentMovement = 0;

let sessionStartTime = null;
let sessionEndTime = null;

let sampleCount = 0;


// ------------------------------------------------------------
// IMPORTANT:
// When true, the next READY from the firmware means:
// "measurement has stopped/finished, return to LIVE"
// ------------------------------------------------------------

let pendingLiveReturn = false;


// Timer used for automatic return to LIVE

let returnToLiveTimer = null;


// Initial USB startup delay

let usbLiveStartTimeout = null;


// Heartbeat

let heartbeatTimer = null;
let lastHeartbeatTime = null;


// ============================================================
// DOM
// ============================================================

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const transportStatus = document.getElementById("transportStatus");
const measurementStatus = document.getElementById("measurementStatus");

const serialMonitor = document.getElementById("serialMonitor");

const usbButton = document.getElementById("usbButton");
const bleButton = document.getElementById("bleButton");

const connectButton = document.getElementById("connectButton");
const disconnectButton = document.getElementById("disconnectButton");

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

const movementValue = document.getElementById("movementValue");
const timeValue = document.getElementById("timeValue");
const samplesValue = document.getElementById("samplesValue");

const axValue = document.getElementById("ax");
const ayValue = document.getElementById("ay");
const azValue = document.getElementById("az");

const gValue = document.getElementById("g");
const angleValue = document.getElementById("angle");

const gxValue = document.getElementById("gx");
const gyValue = document.getElementById("gy");
const gzValue = document.getElementById("gz");

const angleYValue = document.getElementById("angley");

const sessionBadge = document.getElementById("sessionBadge");
const movementList = document.getElementById("movementList");


// ============================================================
// INITIAL UI
// ============================================================

setStatus("Sensor not connected", false);

if (transportStatus) {
    transportStatus.textContent = "No transport selected";
}

if (measurementStatus) {
    measurementStatus.textContent = "No active measurement";
}

if (sessionBadge) {
    sessionBadge.textContent = "IDLE";
}

updateButtons();


// ============================================================
// STATUS
// ============================================================

function setStatus(text, connected = false) {

    if (statusText) {
        statusText.textContent = text;
    }

    if (statusDot) {
        statusDot.classList.toggle("connected", connected);
    }
}


function setTransportStatus(text) {

    if (transportStatus) {
        transportStatus.textContent = text;
    }
}


// ============================================================
// SERIAL MONITOR
// ============================================================

const MAX_MONITOR_LINES = 500;

function appendSerialLine(line) {

    if (!serialMonitor) {
        return;
    }

    // LIVE data is intentionally NOT printed into the monitor.
    // At 50 Hz this would overload the browser DOM.

    if (line.startsWith("LIVE,")) {
        return;
    }

    const div = document.createElement("div");

    div.textContent = line;

    serialMonitor.appendChild(div);

    while (serialMonitor.children.length > MAX_MONITOR_LINES) {
        serialMonitor.removeChild(serialMonitor.firstChild);
    }

    serialMonitor.scrollTop = serialMonitor.scrollHeight;
}


// ============================================================
// FORMAT HELPERS
// ============================================================

function formatNumber(value, digits = 3) {

    if (value === null || value === undefined || Number.isNaN(value)) {
        return "—";
    }

    return Number(value).toFixed(digits);
}


function formatTime(milliseconds) {

    if (milliseconds === null || milliseconds === undefined) {
        return "0.00 s";
    }

    return (milliseconds / 1000).toFixed(2) + " s";
}


// ============================================================
// TRANSPORT BASE CLASS
// ============================================================

class SensorTransport {

    async connect() {
        throw new Error("connect() not implemented");
    }

    async disconnect() {
        throw new Error("disconnect() not implemented");
    }

    async send(command) {
        throw new Error("send() not implemented");
    }
}


// ============================================================
// WEB SERIAL
// ============================================================

class WebSerialTransport extends SensorTransport {

    constructor() {

        super();

        this.port = null;
        this.reader = null;
        this.keepReading = false;

        this.textDecoder = new TextDecoder();
        this.buffer = "";
    }


    async connect() {

        if (!("serial" in navigator)) {
            throw new Error("Web Serial is not supported by this browser.");
        }

        this.port = await navigator.serial.requestPort({
            filters: [
                {
                    usbVendorId: USB_VENDOR_ID,
                    usbProductId: USB_PRODUCT_ID
                }
            ]
        });

        await this.port.open({
            baudRate: 115200
        });

        this.keepReading = true;

        this.readLoop();

        transportType = "USB";

        setTransportStatus("Transport connected: Web Serial");

        setStatus("Sensor connected via USB", true);

        console.log("Transport connected: Web Serial");
    }


    async readLoop() {

        while (this.keepReading && this.port && this.port.readable) {

            try {

                this.reader = this.port.readable.getReader();

                while (this.keepReading) {

                    const { value, done } =
                        await this.reader.read();

                    if (done) {
                        break;
                    }

                    if (value) {

                        this.buffer +=
                            this.textDecoder.decode(value, {
                                stream: true
                            });

                        let lines =
                            this.buffer.split(/\r?\n/);

                        this.buffer =
                            lines.pop() || "";

                        for (const line of lines) {

                            const cleanLine =
                                line.trim();

                            if (cleanLine) {
                                processSerialLine(cleanLine);
                            }
                        }
                    }
                }

                this.reader.releaseLock();
                this.reader = null;

            } catch (error) {

                console.error(
                    "Serial read error:",
                    error
                );

                break;
            }
        }
    }


    async send(command) {

        if (!this.port || !this.port.writable) {
            throw new Error("USB sensor is not connected.");
        }

        const writer =
            this.port.writable.getWriter();

        const encoder =
            new TextEncoder();

        await writer.write(
            encoder.encode(command)
        );

        writer.releaseLock();

        console.log("> " + command);
        appendSerialLine("> " + command);
    }


    async disconnect() {

        this.keepReading = false;

        try {

            if (this.reader) {
                await this.reader.cancel();
            }

        } catch (error) {

            console.warn(
                "Serial reader cancel:",
                error
            );
        }

        try {

            if (this.port) {
                await this.port.close();
            }

        } catch (error) {

            console.warn(
                "Serial close:",
                error
            );
        }

        this.reader = null;
        this.port = null;
    }
}


// ============================================================
// WEB USB
// ============================================================

class WebUSBTransport extends SensorTransport {

    constructor() {

        super();

        this.device = null;
        this.keepReading = false;
        this.buffer = "";

        this.interfaceNumber = 1;
        this.endpointIn = 1;
        this.endpointOut = 1;
    }


    async connect() {

        if (!("usb" in navigator)) {
            throw new Error("WebUSB is not supported.");
        }

        this.device = await navigator.usb.requestDevice({
            filters: [
                {
                    vendorId: USB_VENDOR_ID,
                    productId: USB_PRODUCT_ID
                }
            ]
        });

        await this.device.open();

        if (this.device.configuration === null) {
            await this.device.selectConfiguration(1);
        }

        await this.device.claimInterface(
            this.interfaceNumber
        );

        this.keepReading = true;

        this.readLoop();

        transportType = "USB";

        setTransportStatus("Transport connected: Web USB");

        setStatus("Sensor connected via USB", true);

        console.log("Transport connected: Web USB");
    }


    async readLoop() {

        while (
            this.keepReading &&
            this.device
        ) {

            try {

                const result =
                    await this.device.transferIn(
                        this.endpointIn,
                        64
                    );

                if (
                    result &&
                    result.data
                ) {

                    const text =
                        new TextDecoder().decode(
                            result.data
                        );

                    this.buffer += text;

                    const lines =
                        this.buffer.split(/\r?\n/);

                    this.buffer =
                        lines.pop() || "";

                    for (const line of lines) {

                        const cleanLine =
                            line.trim();

                        if (cleanLine) {
                            processSerialLine(cleanLine);
                        }
                    }
                }

            } catch (error) {

                if (this.keepReading) {

                    console.error(
                        "WebUSB read error:",
                        error
                    );
                }

                break;
            }
        }
    }


    async send(command) {

        if (!this.device) {
            throw new Error("USB device not connected.");
        }

        const encoder =
            new TextEncoder();

        await this.device.transferOut(
            this.endpointOut,
            encoder.encode(command)
        );

        console.log("> " + command);
        appendSerialLine("> " + command);
    }


    async disconnect() {

        this.keepReading = false;

        try {

            if (this.device) {
                await this.device.close();
            }

        } catch (error) {

            console.warn(
                "WebUSB close:",
                error
            );
        }

        this.device = null;
    }
}


// ============================================================
// WEB BLUETOOTH
// ============================================================

class WebBluetoothTransport extends SensorTransport {

    constructor() {

        super();

        this.device = null;
        this.server = null;

        this.liveCharacteristic = null;
        this.commandCharacteristic = null;

        this.onDisconnected =
            this.handleDisconnected.bind(this);
    }


    async connect() {

        if (!("bluetooth" in navigator)) {
            throw new Error(
                "Web Bluetooth is not supported."
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
            this.onDisconnected
        );

        this.server =
            await this.device.gatt.connect();

        const sensorService =
            await this.server.getPrimaryService(
                BLE_SENSOR_SERVICE_UUID
            );

        const controlService =
            await this.server.getPrimaryService(
                BLE_CONTROL_SERVICE_UUID
            );

        this.liveCharacteristic =
            await sensorService.getCharacteristic(
                BLE_LIVE_CHARACTERISTIC_UUID
            );

        this.commandCharacteristic =
            await controlService.getCharacteristic(
                BLE_COMMAND_CHARACTERISTIC_UUID
            );

        await this.liveCharacteristic.startNotifications();

        this.liveCharacteristic.addEventListener(
            "characteristicvaluechanged",
            event => {

                const decoder =
                    new TextDecoder();

                const text =
                    decoder.decode(
                        event.target.value
                    );

                const lines =
                    text.split(/\r?\n/);

                for (const line of lines) {

                    const cleanLine =
                        line.trim();

                    if (cleanLine) {
                        processSerialLine(cleanLine);
                    }
                }
            }
        );

        transportType = "BLE";

        setTransportStatus(
            "Transport connected: Web Bluetooth"
        );

        setStatus(
            "Sensor connected via BLE",
            true
        );

        console.log(
            "Transport connected: Web Bluetooth"
        );
    }


    async send(command) {

        if (!this.commandCharacteristic) {
            throw new Error(
                "BLE sensor is not connected."
            );
        }

        const encoder =
            new TextEncoder();

        await this.commandCharacteristic.writeValue(
            encoder.encode(command)
        );

        console.log("> " + command);
        appendSerialLine("> " + command);
    }


    async disconnect() {

        try {

            if (
                this.liveCharacteristic
            ) {

                try {
                    await this.liveCharacteristic
                        .stopNotifications();
                } catch (error) {
                    console.warn(
                        "BLE stop notifications:",
                        error
                    );
                }
            }

            if (
                this.device &&
                this.device.gatt.connected
            ) {
                this.device.gatt.disconnect();
            }

        } catch (error) {

            console.warn(
                "BLE disconnect:",
                error
            );
        }

        this.device = null;
        this.server = null;

        this.liveCharacteristic = null;
        this.commandCharacteristic = null;
    }


    handleDisconnected() {

        console.log(
            "BLE device disconnected."
        );

        handleSensorDisconnected();
    }
}


// ============================================================
// CREATE TRANSPORT
// ============================================================

function createSensorTransport(type) {

    if (type === "USB") {

        if ("serial" in navigator) {
            return new WebSerialTransport();
        }

        if ("usb" in navigator) {
            return new WebUSBTransport();
        }

        throw new Error(
            "This browser does not support USB communication."
        );
    }


    if (type === "BLE") {

        return new WebBluetoothTransport();
    }


    throw new Error(
        "Unknown transport: " + type
    );
}


// ============================================================
// HEARTBEAT
// ============================================================

function startHeartbeatMonitor() {

    stopHeartbeatMonitor();

    lastHeartbeatTime = Date.now();

    heartbeatTimer = setInterval(() => {

        if (!sensorTransport) {
            return;
        }

        if (
            lastHeartbeatTime &&
            Date.now() - lastHeartbeatTime > 5000
        ) {

            console.warn(
                "No heartbeat received for more than 5 seconds."
            );
        }

    }, 2000);
}


function stopHeartbeatMonitor() {

    if (heartbeatTimer) {

        clearInterval(heartbeatTimer);

        heartbeatTimer = null;
    }

    lastHeartbeatTime = null;
}


// ============================================================
// LIVE VALUES
// ============================================================

function resetLiveValues() {

    if (movementValue) {
        movementValue.textContent = "—";
    }

    if (timeValue) {
        timeValue.textContent = "—";
    }

    if (samplesValue) {
        samplesValue.textContent = "0";
    }

    if (axValue) axValue.textContent = "—";
    if (ayValue) ayValue.textContent = "—";
    if (azValue) azValue.textContent = "—";

    if (gValue) gValue.textContent = "—";
    if (angleValue) angleValue.textContent = "—";

    if (gxValue) gxValue.textContent = "—";
    if (gyValue) gyValue.textContent = "—";
    if (gzValue) gzValue.textContent = "—";

    if (angleYValue) angleYValue.textContent = "—";
}


// ============================================================
// PROCESS LIVE DATA
// ============================================================

function processLiveData(line) {

    const parts =
        line.split(",");

    if (parts.length < 10) {
        return;
    }

    const AX = Number(parts[1]);
    const AY = Number(parts[2]);
    const AZ = Number(parts[3]);
    const G = Number(parts[4]);
    const Angle = Number(parts[5]);
    const GX = Number(parts[6]);
    const GY = Number(parts[7]);
    const GZ = Number(parts[8]);
    const AngleY = Number(parts[9]);


    if (axValue) {
        axValue.textContent =
            formatNumber(AX, 4);
    }

    if (ayValue) {
        ayValue.textContent =
            formatNumber(AY, 4);
    }

    if (azValue) {
        azValue.textContent =
            formatNumber(AZ, 4);
    }

    if (gValue) {
        gValue.textContent =
            formatNumber(G, 4);
    }

    if (angleValue) {
        angleValue.textContent =
            formatNumber(Angle, 2);
    }

    if (gxValue) {
        gxValue.textContent =
            formatNumber(GX, 4);
    }

    if (gyValue) {
        gyValue.textContent =
            formatNumber(GY, 4);
    }

    if (gzValue) {
        gzValue.textContent =
            formatNumber(GZ, 4);
    }

    if (angleYValue) {
        angleYValue.textContent =
            formatNumber(AngleY, 2);
    }
}


// ============================================================
// PROCESS SENSOR LINE
// ============================================================

function processSerialLine(line) {

    console.log(line);

    appendSerialLine(line);


    // --------------------------------------------------------
    // LIVE
    // --------------------------------------------------------

    if (line.startsWith("LIVE,")) {

        processLiveData(line);

        return;
    }


    // --------------------------------------------------------
    // HEARTBEAT
    // --------------------------------------------------------

    if (line === "HEARTBEAT") {

        lastHeartbeatTime = Date.now();

        return;
    }


    // --------------------------------------------------------
    // READY
    //
    // IMPORTANT:
    // READY itself does NOT always mean "start LIVE".
    //
    // Only if pendingLiveReturn === true do we return to LIVE.
    // --------------------------------------------------------

    if (line === "READY") {

        measuring = false;

        if (measurementStatus) {
            measurementStatus.textContent =
                "Sensor ready";
        }

        if (sessionBadge) {
            sessionBadge.textContent = "READY";
        }

        updateButtons();


        const shouldReturnToLive =
            pendingLiveReturn;

        pendingLiveReturn = false;


        if (shouldReturnToLive && sensorTransport) {

            scheduleReturnToLive(300);
        }

        return;
    }


    // --------------------------------------------------------
    // BLE READY
    // --------------------------------------------------------

    if (line === "BLE READY") {

        setStatus(
            "Sensor connected via BLE",
            true
        );

        return;
    }


    // --------------------------------------------------------
    // LIVE MODE
    // --------------------------------------------------------

    if (line === "INFO,LIVE_MODE") {

        setStatus(
            "LIVE mode",
            true
        );

        return;
    }


    // --------------------------------------------------------
    // LIVE START
    // --------------------------------------------------------

    if (line === "INFO,LIVE_START") {

        measuring = false;

        if (measurementStatus) {
            measurementStatus.textContent =
                "LIVE streaming";
        }

        if (sessionBadge) {
            sessionBadge.textContent = "LIVE";
        }

        updateButtons();

        return;
    }


    // --------------------------------------------------------
    // LIVE STOP
    // --------------------------------------------------------

    if (line === "INFO,LIVE_STOP") {

        return;
    }


    // --------------------------------------------------------
    // OLD STYLE LIVE START
    // --------------------------------------------------------

    if (line === "LIVE START") {

        return;
    }


    // --------------------------------------------------------
    // MEASUREMENT START
    // --------------------------------------------------------

    if (line === "INFO,START") {

        measuring = true;

        currentMovement = 0;
        sampleCount = 0;

        sessionStartTime = Date.now();
        sessionEndTime = null;

        if (measurementStatus) {
            measurementStatus.textContent =
                "Measurement starting";
        }

        if (sessionBadge) {
            sessionBadge.textContent =
                "MEASURING";
        }

        if (movementList) {
            movementList.innerHTML = "";
        }

        updateButtons();

        return;
    }


    // --------------------------------------------------------
    // PREPARE
    // --------------------------------------------------------

    if (line === "INFO,PREPARE") {

        measuring = true;

        if (measurementStatus) {
            measurementStatus.textContent =
                "Preparing...";
        }

        updateButtons();

        return;
    }


    // --------------------------------------------------------
    // COUNTDOWN
    // --------------------------------------------------------

    if (line.startsWith("COUNTDOWN,")) {

        const value =
            line.split(",")[1];

        if (measurementStatus) {

            measurementStatus.textContent =
                "Countdown: " + value;
        }

        return;
    }


    // --------------------------------------------------------
    // MOVEMENT
    // --------------------------------------------------------

    if (line.startsWith("INFO,MOVEMENT_")) {

        const match =
            line.match(
                /INFO,MOVEMENT_(\d+)/
            );

        if (match) {

            currentMovement =
                Number(match[1]);

            if (movementValue) {
                movementValue.textContent =
                    currentMovement;
            }

            if (measurementStatus) {
                measurementStatus.textContent =
                    "Recording movement " +
                    currentMovement;
            }
        }

        updateButtons();

        return;
    }


    // --------------------------------------------------------
    // WAIT
    // --------------------------------------------------------

    if (
        line === "INFO,WAIT" ||
        line.startsWith("INFO,WAIT_AFTER_MOVEMENT_")
    ) {

        if (measurementStatus) {
            measurementStatus.textContent =
                "Waiting...";
        }

        return;
    }


    // --------------------------------------------------------
    // MOVEMENT COMPLETE
    // --------------------------------------------------------

    if (
        line.startsWith(
            "INFO,MOVEMENT_"
        ) &&
        line.endsWith(
            "_COMPLETE"
        )
    ) {

        return;
    }


    // --------------------------------------------------------
    // CSV HEADER
    // --------------------------------------------------------

    if (
        line.startsWith(
            "MOVEMENT,TIME_ms"
        )
    ) {

        return;
    }


    // --------------------------------------------------------
    // CSV SAMPLE
    //
    // movement,time,AX,AY,AZ,G,Angle,GX,GY,GZ,AngleY
    // --------------------------------------------------------

    if (
        /^\d+,\d+,-?\d/.test(line)
    ) {

        const parts =
            line.split(",");

        if (parts.length >= 11) {

            const movement =
                Number(parts[0]);

            const timeMs =
                Number(parts[1]);

            sampleCount++;

            if (samplesValue) {
                samplesValue.textContent =
                    sampleCount;
            }

            if (movementValue) {
                movementValue.textContent =
                    movement;
            }

            if (timeValue) {
                timeValue.textContent =
                    formatTime(timeMs);
            }
        }

        return;
    }


    // --------------------------------------------------------
    // END OF MEASUREMENT
    // --------------------------------------------------------

    if (
        line === "END,ALL_MOVEMENTS"
    ) {

        measuring = false;

        sessionEndTime = Date.now();

        if (measurementStatus) {
            measurementStatus.textContent =
                "Measurement finished. Waiting for READY...";
        }

        if (sessionBadge) {
            sessionBadge.textContent =
                "FINISHED";
        }

        // ----------------------------------------------------
        // IMPORTANT:
        //
        // We DO NOT send L here.
        //
        // Firmware will send READY after finishing its state.
        // READY will then trigger the return to LIVE.
        // ----------------------------------------------------

        pendingLiveReturn = true;

        updateButtons();

        return;
    }
}


// ============================================================
// SEND COMMAND
// ============================================================

async function sendCommand(command) {

    if (!sensorTransport) {

        console.warn(
            "No sensor transport connected."
        );

        return false;
    }

    try {

        await sensorTransport.send(command);

        return true;

    } catch (error) {

        console.error(
            "Command error:",
            error
        );

        appendSerialLine(
            "ERROR: " + error.message
        );

        return false;
    }
}


// ============================================================
// START LIVE
// ============================================================

async function startLiveMode() {

    if (!sensorTransport) {
        return;
    }

    cancelReturnToLive();

    pendingLiveReturn = false;

    await sendCommand("L");
}


// ============================================================
// SCHEDULE RETURN TO LIVE
// ============================================================

function scheduleReturnToLive(delay = 300) {

    cancelReturnToLive();

    if (!sensorTransport) {
        return;
    }

    returnToLiveTimer = setTimeout(
        async () => {

            returnToLiveTimer = null;

            if (!sensorTransport) {
                return;
            }

            console.log(
                "Returning automatically to LIVE."
            );

            appendSerialLine(
                "Returning automatically to LIVE..."
            );

            await startLiveMode();

        },
        delay
    );
}


// ============================================================
// CANCEL RETURN TO LIVE
// ============================================================

function cancelReturnToLive() {

    if (returnToLiveTimer) {

        clearTimeout(
            returnToLiveTimer
        );

        returnToLiveTimer = null;
    }
}


// ============================================================
// USB INITIAL LIVE START
// ============================================================

function scheduleUSBLiveStart() {

    if (usbLiveStartTimeout) {

        clearTimeout(
            usbLiveStartTimeout
        );
    }

    console.log(
        "Waiting 2 seconds for sensor startup..."
    );

    appendSerialLine(
        "Waiting 2 seconds for sensor startup..."
    );

    usbLiveStartTimeout =
        setTimeout(
            async () => {

                usbLiveStartTimeout = null;

                if (
                    sensorTransport &&
                    transportType === "USB"
                ) {

                    console.log(
                        "Sensor startup delay complete → starting LIVE."
                    );

                    appendSerialLine(
                        "Sensor startup delay complete → starting LIVE."
                    );

                    await startLiveMode();
                }

            },
            2000
        );
}


// ============================================================
// CONNECT SENSOR
// ============================================================

async function connectSensor() {

    if (sensorTransport) {

        console.warn(
            "Sensor already connected."
        );

        return;
    }

    cancelReturnToLive();

    pendingLiveReturn = false;

    try {

        sensorTransport =
            createSensorTransport(
                selectedTransport
            );

        await sensorTransport.connect();

        startHeartbeatMonitor();

        // ----------------------------------------------------
        // BLE:
        // firmware may already be waiting in READY state.
        // We explicitly start LIVE.
        // ----------------------------------------------------

        if (selectedTransport === "BLE") {

            await startLiveMode();
        }


        // ----------------------------------------------------
        // USB:
        // give Arduino time after USB connection/reset.
        // ----------------------------------------------------

        if (selectedTransport === "USB") {

            scheduleUSBLiveStart();
        }

        updateButtons();

    } catch (error) {

        console.error(
            "Connection error:",
            error
        );

        appendSerialLine(
            "ERROR: " + error.message
        );

        setStatus(
            "Connection failed",
            false
        );

        setTransportStatus(
            "Connection failed"
        );

        sensorTransport = null;

        stopHeartbeatMonitor();

        updateButtons();
    }
}


// ============================================================
// START MEASUREMENT
// ============================================================

async function startMeasurement() {

    if (!sensorTransport) {

        alert(
            "Connect the sensor first."
        );

        return;
    }

    if (measuring) {

        console.warn(
            "Measurement already running."
        );

        return;
    }


    cancelReturnToLive();

    pendingLiveReturn = false;

    sampleCount = 0;
    currentMovement = 0;

    if (samplesValue) {
        samplesValue.textContent = "0";
    }

    if (sessionBadge) {
        sessionBadge.textContent =
            "STARTING";
    }

    if (measurementStatus) {
        measurementStatus.textContent =
            "Starting measurement...";
    }

    measuring = true;

    updateButtons();


    const success =
        await sendCommand("S");

    if (!success) {

        measuring = false;

        if (sessionBadge) {
            sessionBadge.textContent =
                "ERROR";
        }

        if (measurementStatus) {
            measurementStatus.textContent =
                "Could not start measurement";
        }

        updateButtons();
    }
}


// ============================================================
// STOP MEASUREMENT
// ============================================================

async function stopMeasurement() {

    if (!sensorTransport) {
        return;
    }

    if (!measuring) {
        return;
    }


    // --------------------------------------------------------
    // CRITICAL:
    //
    // Tell frontend that after firmware sends READY,
    // we want to return to LIVE.
    // --------------------------------------------------------

    pendingLiveReturn = true;


    if (measurementStatus) {
        measurementStatus.textContent =
            "Stopping measurement...";
    }

    if (sessionBadge) {
        sessionBadge.textContent =
            "STOPPING";
    }


    // Prevent another S while Q is being processed

    measuring = false;

    updateButtons();


    // Q stops measurement / LIVE in firmware.
    // Firmware then sends READY.
    // READY -> pendingLiveReturn -> L -> LIVE

    await sendCommand("Q");
}


// ============================================================
// FINISH SESSION
// ============================================================

function finishSession() {

    measuring = false;

    sessionEndTime = Date.now();

    if (measurementStatus) {
        measurementStatus.textContent =
            "Measurement finished. Waiting for READY...";
    }

    if (sessionBadge) {
        sessionBadge.textContent =
            "FINISHED";
    }

    // --------------------------------------------------------
    // Do NOT send L here.
    //
    // Firmware must first send READY.
    // READY will trigger L.
    // --------------------------------------------------------

    pendingLiveReturn = true;

    updateButtons();
}


// ============================================================
// DISCONNECT
// ============================================================

async function disconnectSensor() {

    // --------------------------------------------------------
    // IMPORTANT:
    // Explicit disconnect must NEVER automatically return
    // to LIVE after READY.
    // --------------------------------------------------------

    pendingLiveReturn = false;

    cancelReturnToLive();


    if (usbLiveStartTimeout) {

        clearTimeout(
            usbLiveStartTimeout
        );

        usbLiveStartTimeout = null;
    }


    stopHeartbeatMonitor();


    if (!sensorTransport) {

        updateButtons();

        return;
    }


    try {

        // Stop active measurement/LIVE before disconnect.

        if (measuring) {

            await sendCommand("Q");

        } else {

            // If currently in LIVE,
            // stop it before disconnect.

            await sendCommand("Q");
        }

    } catch (error) {

        console.warn(
            "Could not send Q before disconnect:",
            error
        );
    }


    try {

        await sensorTransport.disconnect();

    } catch (error) {

        console.warn(
            "Disconnect error:",
            error
        );
    }


    sensorTransport = null;

    transportType = null;

    measuring = false;

    currentMovement = 0;

    setStatus(
        "Sensor not connected",
        false
    );

    setTransportStatus(
        "Sensor disconnected"
    );

    if (measurementStatus) {
        measurementStatus.textContent =
            "No active measurement";
    }

    if (sessionBadge) {
        sessionBadge.textContent =
            "IDLE";
    }

    updateButtons();

    console.log(
        "Sensor disconnected."
    );

    appendSerialLine(
        "Sensor disconnected."
    );
}


// ============================================================
// HANDLE UNEXPECTED DISCONNECT
// ============================================================

function handleSensorDisconnected() {

    pendingLiveReturn = false;

    cancelReturnToLive();

    if (usbLiveStartTimeout) {

        clearTimeout(
            usbLiveStartTimeout
        );

        usbLiveStartTimeout = null;
    }

    stopHeartbeatMonitor();

    sensorTransport = null;

    transportType = null;

    measuring = false;

    setStatus(
        "Sensor disconnected",
        false
    );

    setTransportStatus(
        "Sensor disconnected"
    );

    if (measurementStatus) {
        measurementStatus.textContent =
            "No active measurement";
    }

    if (sessionBadge) {
        sessionBadge.textContent =
            "IDLE";
    }

    updateButtons();
}


// ============================================================
// BUTTON STATE
// ============================================================

function updateButtons() {

    const connected =
        !!sensorTransport;


    // --------------------------------------------------------
    // Connect
    // --------------------------------------------------------

    if (connectButton) {
        connectButton.disabled =
            connected;
    }


    // --------------------------------------------------------
    // Disconnect
    // --------------------------------------------------------

    if (disconnectButton) {
        disconnectButton.disabled =
            !connected;
    }


    // --------------------------------------------------------
    // START
    //
    // Available when connected and not measuring.
    // --------------------------------------------------------

    if (startButton) {
        startButton.disabled =
            !connected ||
            measuring;
    }


    // --------------------------------------------------------
    // STOP
    //
    // Available ONLY during measurement.
    // --------------------------------------------------------

    if (stopButton) {
        stopButton.disabled =
            !connected ||
            !measuring;
    }


    // --------------------------------------------------------
    // Transport buttons
    // --------------------------------------------------------

    if (usbButton) {
        usbButton.classList.toggle(
            "active",
            selectedTransport === "USB"
        );
    }

    if (bleButton) {
        bleButton.classList.toggle(
            "active",
            selectedTransport === "BLE"
        );
    }
}


// ============================================================
// TRANSPORT SELECTION
// ============================================================

if (usbButton) {

    usbButton.addEventListener(
        "click",
        () => {

            if (sensorTransport) {
                return;
            }

            selectedTransport = "USB";

            console.log(
                "Selected transport: USB"
            );

            appendSerialLine(
                "Selected transport: USB"
            );

            setTransportStatus(
                "USB selected"
            );

            updateButtons();
        }
    );
}


if (bleButton) {

    bleButton.addEventListener(
        "click",
        () => {

            if (sensorTransport) {
                return;
            }

            selectedTransport = "BLE";

            console.log(
                "Selected transport: BLE"
            );

            appendSerialLine(
                "Selected transport: BLE"
            );

            setTransportStatus(
                "BLE selected"
            );

            updateButtons();
        }
    );
}


// ============================================================
// CONNECT BUTTON
// ============================================================

if (connectButton) {

    connectButton.addEventListener(
        "click",
        connectSensor
    );
}


// ============================================================
// DISCONNECT BUTTON
// ============================================================

if (disconnectButton) {

    disconnectButton.addEventListener(
        "click",
        disconnectSensor
    );
}


// ============================================================
// START BUTTON
// ============================================================

if (startButton) {

    startButton.addEventListener(
        "click",
        startMeasurement
    );
}


// ============================================================
// STOP BUTTON
// ============================================================

if (stopButton) {

    stopButton.addEventListener(
        "click",
        stopMeasurement
    );
}


// ============================================================
// DEBUG
// ============================================================

window.gazelaSensorDebug = {

    getTransport: () =>
        sensorTransport,

    getTransportType: () =>
        transportType,

    getSelectedTransport: () =>
        selectedTransport,

    isMeasuring: () =>
        measuring,

    getCurrentMovement: () =>
        currentMovement,

    getSampleCount: () =>
        sampleCount,

    getPendingLiveReturn: () =>
        pendingLiveReturn,

    getReturnToLiveTimer: () =>
        returnToLiveTimer
};


console.log(
    "Gazela Sensor app.js loaded."
);
