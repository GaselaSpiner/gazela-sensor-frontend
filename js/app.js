// app.js — GAZELA SENSOR V53 CONTACT RECORDER V2 SESSION + V51 BLE/USB
//
// V48 ARCHITECTURE:
// 1. One application file: app.js. No additional JavaScript modules.
// 2. BLE is the athlete/training transport: LIVE + S measurement + Q stop.
// 3. USB is service/diagnostic transport only: no automatic L and no S/Q.
// 4. One shared sensor/FIFO firmware engine; transport is not a second sensor engine.
// 5. BLE notification text is buffered across notifications so fragmented lines are preserved.
// 6. LIVE parser accepts optional SEQ and FIFO_SEQ fields from firmware V25.
// 7. No firmware protocol, FIFO, sensor calculation, or battery calibration changes.
// 8. V47 behavior is retained where not explicitly changed above.
// 9. V50 detects an unexpectedly ended USB read loop, clears stale app state,
//    and releases the transport so USB can reconnect without a page refresh.
// ========================================================
//
// V40 TEST PURPOSE
// --------------------------------------------------------
// V37 established that the Arduino exposes:
//   configuration = 1
//   interface 0 = CDC control
//   interface 1 = CDC data
//   interface 1 = bulk IN + bulk OUT
//
// V38 tested Web Serial, but the Android flow for this project
// must remain WebUSB for the USB transport.
//
// V39 restores WebUSB and performs the CDC initialization in
// the standard order:
//   1. request/open USB device
//   2. activate configuration 1 if necessary
//   3. claim CDC control interface 0
//   4. SET_LINE_CODING = 115200, 8N1
//   5. SET_CONTROL_LINE_STATE = DTR
//   6. claim CDC data interface 1
//   7. transferIn endpoint 1
//   8. transferOut endpoint 1
//
// V47 CHANGES:
// 1. Keeps the V46 USB RX byte diagnostic.
// 2. A valid LIVE frame can satisfy initial CONNECT readiness.
// 3. If LIVE is already active after USB reconnect, CONNECT does not send L again.
// 4. No firmware, BLE or measurement protocol changes.
//
// V43 FIXES:
// 1. PC + USB uses Web Serial. Android + USB uses WebUSB.
// 2. Status Monitor suppresses raw LIVE and measurement samples.
// 3. Manual STOP uses Q -> READY/HEARTBEAT -> L -> LIVE.
// 4. Automatic measurement completion remains END -> READY/HEARTBEAT -> L -> LIVE.
//
// BLE remains unchanged.
// USB architecture:
//   PC      -> Web Serial
//   Android -> WebUSB
//
// This is still a diagnostic build. The logs deliberately show
// the exact WebUSB step at which Android may reject the operation.
// ========================================================
// // ========================================================
// BLE UUIDs
// ========================================================
const BLE_SENSOR_SERVICE_UUID =
    "7a1e0001-5a9a-4c71-9b3a-47415a5a0001";
const BLE_CONTACT_CAPTURE_CHARACTERISTIC_UUID =
    "7a1e0003-5a9a-4c71-9b3a-47415a5a0001";
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
let sensorTransport = null; // Compatibility alias: active LIVE transport (BLE preferred).
let transportType = null;
let selectedTransport = "ble"; // UI selection only; never determines transport ownership.
let bleTransport = null;
let usbTransport = null;
let activeDataSource = null;
let bleConnecting = false;
let usbConnecting = false;
let measuring = false;
let currentMovement = 0;
let sessionStartTime = null;
let sessionEndTime = null;
let sampleCount = 0;
// ========================================================
// LIVE SEQUENCE TRACKING (V48)
// ========================================================
let lastLiveFrameSequence = null;
let lastLiveFifoSequence = null;
let liveSequenceGapCount = 0;
let fifoSequenceGapCount = 0;
// ========================================================
// SENSOR READY STATE
// ========================================================
let sensorReady = false;
let waitingForInitialReady = false;
let returnToLiveAfterReady = false;
let measurementCommandSent = false;
// V47: true when a valid LIVE frame arrives while CONNECT is waiting for READY/HEARTBEAT.
let liveDetectedDuringInitialConnect = false;
// ========================================================
// HEARTBEAT
// ========================================================
let lastHeartbeatTime = 0;
let heartbeatMonitor = null;
const HEARTBEAT_TIMEOUT = 3000;
// ========================================================
// DOM ELEMENTS
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
const serviceModeToggle =
    document.getElementById("serviceModeToggle");
const serviceModeContent =
    document.getElementById("serviceModeContent");
const serviceConnectionStatus =
    document.getElementById("serviceConnectionStatus");
const serviceTransportLog = document.getElementById("serviceTransportLog");
const serviceFifoLog = document.getElementById("serviceFifoLog");
const serviceBmiLog = document.getElementById("serviceBmiLog");
const serviceBatteryLog = document.getElementById("serviceBatteryLog");
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
// BATTERY UI
// ========================================================
// Firmware format: BAT,cell1,pack,cell2
// ========================================================
const batteryPackValue =
    document.getElementById("batteryPack");
const batteryCell1Value =
    document.getElementById("batteryCell1");
const batteryCell2Value =
    document.getElementById("batteryCell2");
const batteryDifferenceValue =
    document.getElementById("batteryDifference");
const batteryStatusValue =
    document.getElementById("batteryStatus");
const batteryUpdatedValue =
    document.getElementById("batteryUpdated");
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
function setStatus(
    text,
    state = "neutral"
) {
    if (statusText) {
        statusText.textContent = text;
    }
    if (statusDot) {
        statusDot.className =
            "status-dot";
        if (state) {
            statusDot.classList.add(state);
        }
    }
}
// ========================================================
// TRANSPORT STATUS
// ========================================================
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
// SERVICE MODE DIAGNOSTICS — READ ONLY
function isServiceModeOpen() {
    return !!(serviceModeToggle && serviceModeContent &&
        serviceModeToggle.getAttribute("aria-expanded") === "true" &&
        !serviceModeContent.hidden);
}
function appendServiceLog(element, line) {
    if (!element || !isServiceModeOpen()) return;
    if (element.textContent.startsWith("Brak odebranych") ||
        element.textContent.startsWith("Oczekiwanie na")) {
        element.textContent = "";
    }
    const rows = element.textContent ? element.textContent.split("\n") : [];
    rows.push(String(line));
    while (rows.length > 120) rows.shift();
    element.textContent = rows.join("\n");
    element.scrollTop = element.scrollHeight;
}
function classifySensorMessage(source, line) {
    if ((source !== "ble" && source !== "usb") || !line) {
        return "unknown";
    }
    if (line.startsWith("LIVE,")) return "live";
    if (line.startsWith("BAT,")) {
        return source === "usb" ? "battery-diagnostic" : "battery-telemetry";
    }
    if (source === "usb") {
        // Battery report lines are classified before generic sensor terms.
        if (/BATTERY|CELL\s*[12]?\s*:|PACK\s*:|VOLTAGE|ADC|CHARG/i.test(line)) {
            return "battery-diagnostic";
        }
        // FIFO runtime reports include extracted ACC/GYRO sample counters.
        if (/FIFO|SEQ|QUEUE|SAMPLE|FRAME|BUFFER|OVERFLOW|UNDERRUN|PAIR MISMATCH|PARSER ERRORS|I2C \/ FIFO|\bA[XYZ]:|\bG[XYZ]:|^G:/i.test(line)) {
            return "fifo-diagnostic";
        }
        if (/BMI270|\bBMI\b|\bIMU\b|ACCELEROMETER|GYROSCOPE|REGISTER|CHIP.?ID|INITIALIZ(?:E|ATION)|CALIBRAT/i.test(line)) {
            return "bmi-diagnostic";
        }
        if (line === "HEARTBEAT" || line === "READY" || line === "BLE READY" || line.startsWith("INFO,")) {
            return "control";
        }
        return "system";
    }
    if (line === "HEARTBEAT" || line === "READY" || line === "BLE READY" || line.startsWith("INFO,")) {
        return "control";
    }
    return "unknown";
}
function routeServiceDiagnosticLine(line, source, messageType) {
    if (source !== "usb" || !isServiceModeOpen()) return;
    // Keep the complete USB diagnostic stream in the transport log.
    appendServiceLog(serviceTransportLog, line);
    // Each diagnostic line is assigned to one specialist panel only.
    if (messageType === "fifo-diagnostic") {
        appendServiceLog(serviceFifoLog, line);
    } else if (messageType === "bmi-diagnostic") {
        appendServiceLog(serviceBmiLog, line);
    } else if (messageType === "battery-diagnostic") {
        appendServiceLog(serviceBatteryLog, line);
    }
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
        Math.max(
            0,
            milliseconds
        );
    const minutes =
        Math.floor(
            totalMs / 60000
        );
    const seconds =
        Math.floor(
            (totalMs % 60000) / 1000
        );
    const ms =
        Math.floor(
            totalMs % 1000
        );
    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0") +
        "." +
        String(ms).padStart(3, "0")
    );
}
// ========================================================
// SENSOR DATA FILTER
// ========================================================
// LIVE and measurement sample lines are processed normally
// but are not printed one-by-one in the Status Monitor.
// ========================================================
function isSensorDataLine(line) {
    if (!line) return false;
    if (line.startsWith("LIVE,")) return true;
    if (line.startsWith("BAT,")) return true;
    if (line.startsWith("MOVEMENT,TIME_ms")) return true;
    if (/^\d+,/.test(line)) return true;
    return false;
}
// ========================================================
// V46 USB RAW RX DIAGNOSTIC
// ========================================================
// Shows exact bytes received from USB before text-line parsing.
// Limited to the first 40 non-empty USB transfers per connection.
// ========================================================
const V46_RAW_RX_MAX_CHUNKS = 40;
function v45BytesToHex(bytes) {
    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
}
function v45BytesToAscii(bytes) {
    return Array.from(bytes)
        .map(byte => {
            if (byte >= 32 && byte <= 126) return String.fromCharCode(byte);
            if (byte === 10) return "\\n";
            if (byte === 13) return "\\r";
            return ".";
        })
        .join("");
}
function v45LogRawUSB(bytes, transportName, chunkNumber) {
    if (!bytes || bytes.length === 0) return;
    if (chunkNumber > V46_RAW_RX_MAX_CHUNKS) return;
    addSerialLine(
        "V46 RAW RX " +
        transportName +
        " #" + chunkNumber +
        " LEN=" + bytes.length +
        " HEX=[" + v45BytesToHex(bytes) + "]" +
        " ASCII=[" + v45BytesToAscii(bytes) + "]",
        "serial-info"
    );
}
// ========================================================
// TRANSPORT BASE
// ========================================================
class SensorTransport {
    constructor(onLine, onEnd = null) {
        this.onLine = onLine;
        this.onEnd = onEnd;
        this.running = false;
        this.readTask = null;
        this.intentionalDisconnect = false;
    }
    startReadTask(readTask) {
        this.readTask = readTask;
        this.readTask.then(() => {
            if (
                !this.running ||
                this.intentionalDisconnect
            ) {
                return;
            }
            this.running = false;
            addSerialLine(
                "V50: transport read loop ended unexpectedly.",
                "serial-error"
            );
            if (typeof this.onEnd === "function") {
                return this.onEnd(
                    this,
                    "read-loop-ended"
                );
            }
        }).catch(error => {
            console.error(
                "V50: read task completion handler:",
                error
            );
        });
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
        addSerialLine(
            "V43: transport disconnect START",
            "serial-info"
        );
        this.intentionalDisconnect = true;
        this.running = false;
    }
    get name() {
        return "Unknown";
    }
}
// ========================================================
// WEB SERIAL TRANSPORT
// ========================================================
class WebSerialTransport
    extends SensorTransport {
    constructor(onLine, onEnd = null) {
        super(onLine, onEnd);
        this.port = null;
        this.reader = null;
        this.v45RxChunkCount = 0;
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
        addSerialLine(
            "V46: Web Serial requestPort() START",
            "serial-info"
        );
        this.port =
            await navigator.serial.requestPort();
        addSerialLine(
            "V46: Web Serial requestPort() OK",
            "serial-info"
        );
        addSerialLine(
            "V46: Web Serial port.open(115200) START",
            "serial-info"
        );
        await this.port.open({
            baudRate: 115200
        });
        addSerialLine(
            "V46: Web Serial port.open(115200) OK",
            "serial-info"
        );
        this.running = true;
        this.intentionalDisconnect = false;
        this.v45RxChunkCount = 0;
        addSerialLine(
            "V46: Web Serial readLoop START",
            "serial-info"
        );
        this.startReadTask(
            this.readLoop()
        );
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
                this.v45RxChunkCount++;
                v45LogRawUSB(
                    value,
                    "WebSerial",
                    this.v45RxChunkCount
                );
                buffer +=
                    decoder.decode(
                        value,
                        {
                            stream: true
                        }
                    );
                const lines =
                    buffer.split(
                        /\r?\n/
                    );
                buffer =
                    lines.pop() || "";
                for (
                    const line
                    of lines
                ) {
                    const cleanLine =
                        line.trim();
                    if (cleanLine) {
                        if (
                            !isSensorDataLine(cleanLine)
                        ) {
                            addSerialLine(
                                "V43: USB RX " +
                                cleanLine,
                                "serial-info"
                            );
                        }
                        this.onLine(
                            cleanLine
                        );
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
                addSerialLine(
                    "Web Serial read error: " +
                    error.message,
                    "serial-error"
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
        throw new Error("WebSerialTransport w SERVICE MODE jest tylko do odczytu. Polecenie nie zostało wysłane: " + command);
    }
    async disconnect() {
        this.intentionalDisconnect = true;
        this.running = false;
        if (this.reader) {
            try {
                await this.reader.cancel();
            }
            catch (error) {
                console.warn(
                    "Web Serial reader cancel:",
                    error
                );
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
                console.warn(
                    "Web Serial close:",
                    error
                );
            }
        }
        this.reader = null;
        this.port = null;
        this.readTask = null;
        addSerialLine(
            "V46: Web Serial disconnect COMPLETE",
            "serial-info"
        );
    }
}
// ========================================================
// WEBUSB TRANSPORT — RETAINED FOR SOURCE HISTORY; NOT USED BY V38 USB
// ========================================================
class WebUSBTransport
    extends SensorTransport {
    constructor(onLine, onEnd = null) {
        super(onLine, onEnd);
        this.device = null;
        this.interface0Claimed = false;
        this.interface1Claimed = false;
        this.decoder =
            new TextDecoder();
        // BLE notifications may split one firmware line across packets.
        this.rxBuffer = "";
        this.encoder =
            new TextEncoder();
        this.buffer = "";
        this.v45RxChunkCount = 0;
    }
    get name() {
        return "WebUSB";
    }
    async connect() {
        if (!("usb" in navigator)) {
            throw new Error(
                "WebUSB nie jest dostępne w tej przeglądarce."
            );
        }
        addSerialLine(
            "V46: WebUSB transport START",
            "serial-info"
        );
        const devices =
            await navigator.usb.getDevices();
        addSerialLine(
            `V46: WebUSB getDevices() count=${devices.length}`,
            "serial-info"
        );
        devices.forEach((device, index) => {
            addSerialLine(
                `V46: USB device #${index + 1} VID=0x${device.vendorId.toString(16).toUpperCase().padStart(4, "0")} PID=0x${device.productId.toString(16).toUpperCase().padStart(4, "0")} manufacturer=${device.manufacturerName || "?"} product=${device.productName || "?"}`,
                "serial-info"
            );
        });
        this.device =
            devices.find(
                device =>
                    device.vendorId ===
                        USB_VENDOR_ID &&
                    device.productId ===
                        USB_PRODUCT_ID
            );
        if (this.device) {
            addSerialLine(
                "V46: WebUSB authorized device FOUND",
                "serial-info"
            );
        }
        else {
            addSerialLine(
                "V46: WebUSB requestDevice() START",
                "serial-info"
            );
            addSerialLine(
                `V46: WebUSB requestDevice() FILTER = vendorId 0x${USB_VENDOR_ID.toString(16).toUpperCase()}, productId 0x${USB_PRODUCT_ID.toString(16).toUpperCase()}`,
                "serial-info"
            );
            // V46: diagnostic fallback — filter by Arduino vendor only.
            // This lets Android show the board even if its PID differs.
            this.device =
                await navigator.usb.requestDevice({
                    filters: [
                        {
                            vendorId:
                                USB_VENDOR_ID
                        }
                    ]
                });
            addSerialLine(
                "V46: WebUSB requestDevice() OK",
                "serial-info"
            );
        }
        try {
            addSerialLine(
                "V40 TEST: device.open() START",
                "serial-info"
            );
            await this.device.open();
            addSerialLine(
                "V40 TEST: device.open() OK",
                "serial-info"
            );
            if (
                this.device.configuration ===
                null
            ) {
                addSerialLine(
                    "V40 TEST: selectConfiguration(1) START",
                    "serial-info"
                );
                await this.device
                    .selectConfiguration(1);
                addSerialLine(
                    "V40 TEST: selectConfiguration(1) OK",
                    "serial-info"
                );
            }
            else if (
                this.device.configuration
                    .configurationValue !== 1
            ) {
                addSerialLine(
                    "V40 TEST: active configuration != 1",
                    "serial-info"
                );
                addSerialLine(
                    "V40 TEST: selectConfiguration(1) START",
                    "serial-info"
                );
                await this.device
                    .selectConfiguration(1);
                addSerialLine(
                    "V40 TEST: selectConfiguration(1) OK",
                    "serial-info"
                );
            }
            else {
                addSerialLine(
                    "V40 TEST: configuration 1 already active",
                    "serial-info"
                );
            }
            const configuration =
                this.device.configuration;
            if (!configuration) {
                throw new Error(
                    "V39: brak aktywnej konfiguracji USB."
                );
            }
            addSerialLine(
                "V40 TEST: interfaces = " +
                configuration.interfaces.length,
                "serial-info"
            );
            for (
                const usbInterface
                of configuration.interfaces
            ) {
                for (
                    const alternate
                    of usbInterface.alternates
                ) {
                    addSerialLine(
                        "V40 TEST: interface " +
                        usbInterface.interfaceNumber +
                        " alt " +
                        alternate.alternateSetting +
                        " class=" +
                        alternate.interfaceClass +
                        " subclass=" +
                        alternate.interfaceSubclass +
                        " protocol=" +
                        alternate.interfaceProtocol +
                        " endpoints=" +
                        alternate.endpoints.length,
                        "serial-info"
                    );
                    for (
                        const endpoint
                        of alternate.endpoints
                    ) {
                        addSerialLine(
                            "V40 TEST: endpoint " +
                            endpoint.endpointNumber +
                            " " +
                            endpoint.direction +
                            " " +
                            endpoint.type +
                            " packet=" +
                            endpoint.packetSize,
                            "serial-info"
                        );
                    }
                }
            }
            // Arduino Nano 33 BLE Sense Rev2 exposes CDC as:
            // interface 0 = CDC control
            // interface 1 = CDC data
            //
            // IMPORTANT:
            // Claim interface 0 FIRST.
            // Then configure the CDC line.
            // Only then claim interface 1.
            //
            // This is intentionally explicit because the earlier
            // diagnostic versions showed claimInterface(1) failing
            // when interface 0 had not been claimed first.
            addSerialLine(
                "V40 TEST: claimInterface(0) START",
                "serial-info"
            );
            await this.device
                .claimInterface(0);
            this.interface0Claimed = true;
            addSerialLine(
                "V40 TEST: claimInterface(0) OK",
                "serial-info"
            );
            // CDC SET_LINE_CODING
            // 115200 baud, 1 stop bit, no parity, 8 data bits.
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
            addSerialLine(
                "V40 TEST: CDC SET_LINE_CODING START",
                "serial-info"
            );
            await this.device
                .controlTransferOut(
                    {
                        requestType:
                            "class",
                        recipient:
                            "interface",
                        request:
                            0x20,
                        value:
                            0x0000,
                        index:
                            0x0000
                    },
                    lineCoding
                );
            addSerialLine(
                "V40 TEST: CDC SET_LINE_CODING OK",
                "serial-info"
            );
            // CDC SET_CONTROL_LINE_STATE
            // DTR = 1.
            addSerialLine(
                "V40 TEST: CDC SET_CONTROL_LINE_STATE START",
                "serial-info"
            );
            await this.device
                .controlTransferOut(
                    {
                        requestType:
                            "class",
                        recipient:
                            "interface",
                        request:
                            0x22,
                        value:
                            0x0001,
                        index:
                            0x0000
                    }
                );
            addSerialLine(
                "V40 TEST: CDC SET_CONTROL_LINE_STATE OK",
                "serial-info"
            );
            addSerialLine(
                "V40 TEST: claimInterface(1) START",
                "serial-info"
            );
            await this.device
                .claimInterface(1);
            this.interface1Claimed = true;
            addSerialLine(
                "V40 TEST: claimInterface(1) OK",
                "serial-info"
            );
            this.running = true;
            this.intentionalDisconnect = false;
            this.v45RxChunkCount = 0;
            addSerialLine(
                "V46: WebUSB readLoop START",
                "serial-info"
            );
            this.startReadTask(
                this.readLoop()
            );
        }
        catch (error) {
            addSerialLine(
                "V46: WebUSB CONNECT ERROR: " +
                error.message,
                "serial-error"
            );
            await this.cleanupAfterConnectError();
            throw error;
        }
    }
    async readLoop() {
        try {
            while (this.running) {
                const result =
                    await this.device
                        .transferIn(
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
                const receivedBytes =
                    new Uint8Array(
                        result.data.buffer,
                        result.data.byteOffset,
                        result.data.byteLength
                    );
                this.v45RxChunkCount++;
                v45LogRawUSB(
                    receivedBytes,
                    "WebUSB",
                    this.v45RxChunkCount
                );
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
                    const line
                    of lines
                ) {
                    const cleanLine =
                        line.trim();
                    if (cleanLine) {
                        if (
                            !isSensorDataLine(cleanLine)
                        ) {
                            addSerialLine(
                                "V43: USB RX " +
                                cleanLine,
                                "serial-info"
                            );
                        }
                        this.onLine(
                            cleanLine
                        );
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
                addSerialLine(
                    "V43: WebUSB read error: " +
                    error.message,
                    "serial-error"
                );
            }
        }
    }
    async send(command) {
        throw new Error("WebUSBTransport w SERVICE MODE jest tylko do odczytu. Polecenie nie zostało wysłane: " + command);
    }
    async disconnect() {
        this.intentionalDisconnect = true;
        this.running = false;
        addSerialLine(
            "V46: WebUSB disconnect START",
            "serial-info"
        );
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
                console.warn(
                    "V39 WebUSB read task:",
                    error
                );
            }
        }
        if (this.device) {
            if (this.interface1Claimed) {
                try {
                    await this.device
                        .releaseInterface(1);
                    addSerialLine(
                        "V40 TEST: interface 1 released",
                        "serial-info"
                    );
                }
                catch (error) {
                    addSerialLine(
                        "V40 TEST: interface 1 release ERROR: " +
                        error.message,
                        "serial-error"
                    );
                }
                this.interface1Claimed =
                    false;
            }
            if (this.interface0Claimed) {
                try {
                    await this.device
                        .releaseInterface(0);
                    addSerialLine(
                        "V40 TEST: interface 0 released",
                        "serial-info"
                    );
                }
                catch (error) {
                    addSerialLine(
                        "V40 TEST: interface 0 release ERROR: " +
                        error.message,
                        "serial-error"
                    );
                }
                this.interface0Claimed =
                    false;
            }
            try {
                await this.device.close();
                addSerialLine(
                    "V46: WebUSB device.close() OK",
                    "serial-info"
                );
            }
            catch (error) {
                addSerialLine(
                    "V43: WebUSB close ERROR: " +
                    error.message,
                    "serial-error"
                );
            }
        }
        this.device = null;
        this.readTask = null;
        this.buffer = "";
        addSerialLine(
            "V46: WebUSB disconnect COMPLETE",
            "serial-info"
        );
    }
}
class WebBluetoothTransport
    extends SensorTransport {
    constructor(onLine) {
        super(onLine);
        this.device = null;
        this.server = null;
        this.sensorService = null;
        this.liveCharacteristic = null;
        this.contactCaptureCharacteristic = null;
        this.controlService = null;
        this.commandCharacteristic = null;
        this.decoder =
            new TextDecoder();
        this.notificationCount = 0;
        this.boundNotificationHandler =
            this.handleNotification.bind(this);
        this.boundContactCaptureHandler = event => contactReceiveDataPacket(event);
        this.boundDisconnectHandler =
            this.handleDisconnected.bind(this);
        // Prevent duplicate handling of the same BLE disconnect event.
        this.disconnectHandled = false;
    }
    get name() {
        return "Web Bluetooth";
    }
    async connect() {
        // This transport instance is starting a new connection attempt.
        this.disconnectHandled = false;
        this.rxBuffer = "";
        this.decoder = new TextDecoder();
        if (!("bluetooth" in navigator)) {
            throw new Error(
                "Web Bluetooth nie jest dostępny w tej przeglądarce."
            );
        }
        addSerialLine(
            "BLE: requestDevice...",
            "serial-info"
        );
        this.device =
            await navigator.bluetooth.requestDevice({
                filters: [
                    {
                        name:
                            "GAZELA SENSOR"
                    }
                ],
                optionalServices: [
                    BLE_SENSOR_SERVICE_UUID,
                    BLE_CONTROL_SERVICE_UUID
                ]
            });
        addSerialLine(
            "BLE: requestDevice OK",
            "serial-info"
        );
        this.device.addEventListener(
            "gattserverdisconnected",
            this.boundDisconnectHandler
        );
        addSerialLine(
            "BLE: GATT connect...",
            "serial-info"
        );
        this.server =
            await this.device.gatt.connect();
        addSerialLine(
            "BLE: GATT connected",
            "serial-info"
        );
        addSerialLine(
            "BLE: get sensor service...",
            "serial-info"
        );
        this.sensorService =
            await this.server
                .getPrimaryService(
                    BLE_SENSOR_SERVICE_UUID
                );
        addSerialLine(
            "BLE: sensor service OK",
            "serial-info"
        );
        addSerialLine(
            "BLE: get live characteristic...",
            "serial-info"
        );
        this.liveCharacteristic =
            await this.sensorService
                .getCharacteristic(
                    BLE_LIVE_CHARACTERISTIC_UUID
                );
        addSerialLine(
            "BLE: live characteristic OK",
            "serial-info"
        );
        addSerialLine(
            "BLE: get control service...",
            "serial-info"
        );
        this.controlService =
            await this.server
                .getPrimaryService(
                    BLE_CONTROL_SERVICE_UUID
                );
        addSerialLine(
            "BLE: control service OK",
            "serial-info"
        );
        addSerialLine(
            "BLE: get command characteristic...",
            "serial-info"
        );
        this.commandCharacteristic =
            await this.controlService
                .getCharacteristic(
                    BLE_COMMAND_CHARACTERISTIC_UUID
                );
        addSerialLine(
            "BLE: command characteristic OK",
            "serial-info"
        );
        addSerialLine(
            "BLE: registering notification listener...",
            "serial-info"
        );
        this.liveCharacteristic.addEventListener(
            "characteristicvaluechanged",
            this.boundNotificationHandler
        );
        addSerialLine(
            "BLE: start notifications...",
            "serial-info"
        );
        await this.liveCharacteristic.startNotifications();
        addSerialLine(
            "BLE: notifications OK",
            "serial-info"
        );
        this.contactCaptureCharacteristic = await this.sensorService.getCharacteristic(BLE_CONTACT_CAPTURE_CHARACTERISTIC_UUID);
        this.contactCaptureCharacteristic.addEventListener("characteristicvaluechanged", this.boundContactCaptureHandler);
        await this.contactCaptureCharacteristic.startNotifications();
        this.running = true;
        addSerialLine(
            "BLE: CONNECT COMPLETE",
            "serial-info"
        );
    }
    handleNotification(event) {
        try {
            const value = event && event.target ? event.target.value : null;
            if (!value) return;
            // Each ArduinoBLE BLEStringCharacteristic.writeValue() is one
            // complete GATT notification. It is not a newline-terminated stream.
            const packet = this.decoder.decode(value).replace(/\0+$/g, "").trim();
            if (!packet) return;
            this.notificationCount++;
            if (this.notificationCount <= 5) {
                addSerialLine("BLE RX #" + this.notificationCount + ": " + packet.slice(0, 140), "serial-info");
                console.info("GAZELA BLE notification", this.notificationCount, packet);
            }
            const messages = packet.split(/\r?\n/).map(message => message.trim()).filter(Boolean);
            for (const message of messages) this.onLine(message);
        } catch (error) {
            console.error("BLE notification error:", error);
            addSerialLine("BLE notification error: " + error.message, "serial-error");
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
        const data =
            new TextEncoder().encode(
                command
            );
        if (typeof this.commandCharacteristic.writeValueWithResponse === "function") {
            await this.commandCharacteristic.writeValueWithResponse(data);
        } else {
            await this.commandCharacteristic.writeValue(data);
        }
    }
    async disconnect() {
        this.running = false;
        if (this.contactCaptureCharacteristic) {
            try { await this.contactCaptureCharacteristic.stopNotifications(); } catch (error) { console.warn(error); }
            this.contactCaptureCharacteristic.removeEventListener("characteristicvaluechanged", this.boundContactCaptureHandler);
        }
        if (
            this.liveCharacteristic
        ) {
            try {
                await this.liveCharacteristic
                    .stopNotifications();
            }
            catch (error) {
                console.warn(
                    "BLE stopNotifications:",
                    error
                );
            }
            try {
                this.liveCharacteristic
                    .removeEventListener(
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
                console.warn(
                    "BLE disconnect:",
                    error
                );
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
        this.contactCaptureCharacteristic = null;
        this.controlService = null;
        this.commandCharacteristic = null;
    }
    handleDisconnected() {
        if (this.disconnectHandled) return;
        this.disconnectHandled = true;
        this.running = false;
        contactDisconnected();
        this.rxBuffer = "";
        addSerialLine("BLE device disconnected.", "serial-error");
        if (this.liveCharacteristic) {
            try { this.liveCharacteristic.removeEventListener("characteristicvaluechanged", this.boundNotificationHandler); }
            catch (error) { console.warn(error); }
        }
        if (this.device) {
            try { this.device.removeEventListener("gattserverdisconnected", this.boundDisconnectHandler); }
            catch (error) { console.warn(error); }
        }
        this.server = null;
        this.sensorService = null;
        this.liveCharacteristic = null;
        this.controlService = null;
        this.commandCharacteristic = null;
        handleUnexpectedTransportEnd(this, "BLE GATT disconnected", "ble").catch(error => console.error("BLE disconnect recovery:", error));
    }
}
// ========================================================
// WAIT FOR SENSOR READY
// ========================================================
function waitForSensorReady(
    timeout = 7000
) {
    if (sensorReady) {
        return Promise.resolve();
    }
    return new Promise(
        (resolve, reject) => {
            let finished = false;
            const timeoutId =
                setTimeout(
                    () => {
                        if (finished) {
                            return;
                        }
                        finished = true;
                        window.__gazelaReadyWaiter =
                            null;
                        reject(
                            new Error(
                                "Sensor nie wysłał READY w wymaganym czasie."
                            )
                        );
                    },
                    timeout
                );
            window.__gazelaReadyWaiter =
                () => {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    clearTimeout(
                        timeoutId
                    );
                    window.__gazelaReadyWaiter =
                        null;
                    resolve();
                };
        }
    );
}
// ========================================================
// TRANSPORT FACTORY
// ========================================================
function isAndroidDevice() {
    if (navigator.userAgentData && navigator.userAgentData.platform && /Android/i.test(navigator.userAgentData.platform)) {
        return true;
    }
    return /Android/i.test(navigator.userAgent || "");
}
async function createSensorTransport(kind) {
    if (kind === "usb") {
        const android = isAndroidDevice();
        if (android) {
            if (!("usb" in navigator)) throw new Error("Android: WebUSB nie jest dostępne w tej przeglądarce.");
            addSerialLine("V51: USB transport = WebUSB (Android)", "serial-info");
            return new WebUSBTransport(line => routeSensorMessage("usb", line), (transport, reason) => handleUnexpectedTransportEnd(transport, reason, "usb"));
        }
        if ("serial" in navigator) {
            addSerialLine("V51: USB transport = Web Serial (PC)", "serial-info");
            return new WebSerialTransport(line => routeSensorMessage("usb", line), (transport, reason) => handleUnexpectedTransportEnd(transport, reason, "usb"));
        }
        if ("usb" in navigator) {
            addSerialLine("V51: USB transport = WebUSB fallback (PC)", "serial-info");
            return new WebUSBTransport(line => routeSensorMessage("usb", line), (transport, reason) => handleUnexpectedTransportEnd(transport, reason, "usb"));
        }
        throw new Error("USB: brak Web Serial oraz WebUSB.");
    }
    if (kind === "ble") {
        if (!("bluetooth" in navigator)) throw new Error("Web Bluetooth nie jest dostępny w tej przeglądarce.");
        addSerialLine("V51: BLE transport = Web Bluetooth", "serial-info");
        return new WebBluetoothTransport(line => routeSensorMessage("ble", line));
    }
    throw new Error("Nieznany transport: " + kind);
}
// ========================================================
// HEARTBEAT MONITOR
// ========================================================
function startHeartbeatMonitor() {
    stopHeartbeatMonitor();
    lastHeartbeatTime =
        Date.now();
    heartbeatMonitor =
        setInterval(
            () => {
                if (!bleTransport) {
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
// ========================================================
// STOP HEARTBEAT MONITOR
// ========================================================
function stopHeartbeatMonitor() {
    if (heartbeatMonitor) {
        clearInterval(
            heartbeatMonitor
        );
        heartbeatMonitor = null;
    }
}
// ========================================================
// RESET LIVE VALUES
// ========================================================
function resetLiveValues() {
    if (movementValue) {
        movementValue.textContent =
            "--";
    }
    if (timeValue) {
        timeValue.textContent =
            "--";
    }
    if (samplesValue) {
        samplesValue.textContent =
            "0";
    }
    if (axValue) {
        axValue.textContent =
            "--";
    }
    if (ayValue) {
        ayValue.textContent =
            "--";
    }
    if (azValue) {
        azValue.textContent =
            "--";
    }
    if (gValue) {
        gValue.textContent =
            "--";
    }
    if (angleValue) {
        angleValue.textContent =
            "--";
    }
    if (gxValue) {
        gxValue.textContent =
            "--";
    }
    if (gyValue) {
        gyValue.textContent =
            "--";
    }
    if (gzValue) {
        gzValue.textContent =
            "--";
    }
    if (angleyValue) {
        angleyValue.textContent =
            "--";
    }
}
// ========================================================
// BATTERY DATA
// ========================================================
function updateBatteryLevel(packVoltage) {
    const batteryLevelFill = document.getElementById("batteryLevelFill");
    const batteryPercent = document.getElementById("batteryPercent");
    const batteryLevelLabel = document.getElementById("batteryLevelLabel");
    const batteryVisual = document.querySelector(".battery-visual");
    if (!Number.isFinite(packVoltage)) return;
    // Przybliżony wskaźnik dla pakietu Li-ion 2S.
    // Wartość procentowa jest szacunkiem opartym na napięciu pakietu.
    const voltagePerCell = packVoltage / 2;
    const curve = [
        [3.30, 0], [3.40, 5], [3.50, 10], [3.60, 20],
        [3.70, 35], [3.80, 50], [3.90, 65], [4.00, 80],
        [4.10, 90], [4.15, 95], [4.20, 100]
    ];
    let percentage;
    if (voltagePerCell <= curve[0][0]) {
        percentage = curve[0][1];
    } else if (voltagePerCell >= curve[curve.length - 1][0]) {
        percentage = 100;
    } else {
        percentage = 0;
        for (let i = 0; i < curve.length - 1; i++) {
            const [v1, p1] = curve[i];
            const [v2, p2] = curve[i + 1];
            if (voltagePerCell >= v1 && voltagePerCell <= v2) {
                percentage = Math.round(p1 + ((voltagePerCell - v1) / (v2 - v1)) * (p2 - p1));
                break;
            }
        }
    }
    percentage = Math.max(0, Math.min(100, percentage));
    // Kolor z histerezą, żeby wskazanie nie migotało przy granicach.
    // Wzrost: czerwony->pomarańczowy 25%, pomarańczowy->żółty 45%, żółty->zielony 65%.
    // Spadek: zielony->żółty 55%, żółty->pomarańczowy 35%, pomarańczowy->czerwony 15%.
    if (typeof window.gazelaBatteryColorBand !== "string") {
        // Inicjalizacja pierwszego odczytu: czerwony do 20%, pomarańczowy do 40%,
        // żółty do 60%, a zielony dopiero powyżej 60%.
        window.gazelaBatteryColorBand = percentage <= 20 ? "red"
            : percentage <= 40 ? "orange"
            : percentage <= 60 ? "yellow" : "green";
    }
    let band = window.gazelaBatteryColorBand;
    if (band === "red") {
        if (percentage >= 25) band = "orange";
    } else if (band === "orange") {
        if (percentage <= 15) band = "red";
        else if (percentage >= 45) band = "yellow";
    } else if (band === "yellow") {
        if (percentage <= 35) band = "orange";
        else if (percentage >= 65) band = "green";
    } else if (band === "green") {
        if (percentage <= 55) band = "yellow";
    }
    window.gazelaBatteryColorBand = band;
    // Komunikat tekstowy jest informacyjny i ma stały kolor.
    // Nie pokazujemy osobnych opisów niskiego/średniego poziomu.
    // Przy >=95% pokazujemy „Bateria naładowana”; w pozostałych przypadkach
    // pozostaje neutralny opis. Samo napięcie nie potwierdza, że ładowarka
    // faktycznie zakończyła ładowanie — firmware musiałby udostępnić taki sygnał.
    const batteryMessage = "";
    // 6 segmentów: od dołu czerwony, pomarańczowy, żółty i 3 zielone.
    // Dzięki temu niski poziom baterii zapala czerwony segment jako pierwszy.
    const segmentColors = ["red", "orange", "yellow", "green", "green", "green"];
    const segmentCount = segmentColors.length;
    // Liczba schodków wynika z procentu, ale jest ograniczona przez stan histerezy.
    // Dzięki temu każda zmiana koloru zmienia liczbę aktywnych schodków o jeden:
    // czerwony = maks. 1, pomarańczowy = maks. 2, żółty = maks. 3,
    // zielony = 4–6 (zależnie od poziomu procentowego).
    const calculatedSegments = percentage <= 0
        ? 0
        : Math.min(segmentCount, Math.ceil((percentage / 100) * segmentCount));
    const maxSegmentsByBand = {
        red: 1,
        orange: 2,
        yellow: 3,
        green: 6
    };
    const activeSegments = Math.min(
        calculatedSegments,
        maxSegmentsByBand[band] ?? segmentCount
    );
    if (batteryLevelFill) {
        // Segmenty są układane od dołu; pierwszy segment znajduje się na dole.
        if (batteryLevelFill.children.length !== segmentCount) {
            batteryLevelFill.replaceChildren();
            for (let i = 0; i < segmentCount; i++) {
                const segment = document.createElement("span");
                segment.className = "battery-segment";
                batteryLevelFill.appendChild(segment);
            }
        }
        batteryLevelFill.classList.remove("level-high", "level-medium", "level-low",
            "level-green", "level-yellow", "level-orange", "level-red");
        batteryLevelFill.classList.add("level-" + band);
        batteryLevelFill.style.height = "100%";
        Array.from(batteryLevelFill.children).forEach((segment, index) => {
            const active = index < activeSegments;
            segment.classList.toggle("active", active);
            segment.classList.remove("segment-green", "segment-yellow", "segment-orange", "segment-red");
            // Wszystkie aktywne schodki mają kolor aktualnego pasma histerezy.
            // Liczba aktywnych schodków jest ograniczona przez pasmo:
            // czerwony maks. 1, pomarańczowy maks. 2, żółty maks. 3,
            // zielony od 4 do 6. Nieaktywne zachowują kolory tła.
            segment.classList.add("segment-" + (active ? band : segmentColors[index]));
        });
    }
    if (batteryPercent) batteryPercent.textContent = percentage + "%";
    if (batteryLevelLabel) {
        batteryLevelLabel.textContent = batteryMessage;
        // Celowo nie ustawiamy style.color — kolor napisu jest stały w CSS.
    }
    if (batteryVisual) {
        batteryVisual.setAttribute(
            "aria-label",
            "Szacowany poziom naładowania baterii: " + percentage + " procent"
        );
    }
}
function resetBatteryValues() {
    if (batteryPackValue) batteryPackValue.textContent = "--";
    if (batteryCell1Value) batteryCell1Value.textContent = "--";
    if (batteryCell2Value) batteryCell2Value.textContent = "--";
    if (batteryDifferenceValue) batteryDifferenceValue.textContent = "--";
    if (batteryStatusValue) {
        batteryStatusValue.textContent = "--";
        batteryStatusValue.className = "battery-status";
    }
    if (batteryUpdatedValue) batteryUpdatedValue.textContent = "Updated: --";
    const batteryLevelFill = document.getElementById("batteryLevelFill");
    const batteryPercent = document.getElementById("batteryPercent");
    const batteryLevelLabel = document.getElementById("batteryLevelLabel");
    const batteryVisual = document.querySelector(".battery-visual");
    if (batteryLevelFill) {
        batteryLevelFill.style.height = "100%";
        batteryLevelFill.replaceChildren();
    }
    if (batteryPercent) batteryPercent.textContent = "--%";
    if (batteryLevelLabel) batteryLevelLabel.textContent = "--";
    if (batteryVisual) {
        batteryVisual.setAttribute("aria-label", "Poziom naładowania baterii nieznany");
    }
    // Nie resetujemy pasma koloru przy krótkim rozłączeniu.
}
function parseBatteryData(line) {
    const parts = line.split(",");
    if (parts.length < 4 || parts[0] !== "BAT") {
        return;
    }
    const cell1 = parseFloat(parts[1]);
    const pack = parseFloat(parts[2]);
    const cell2 = parseFloat(parts[3]);
    if (
        !Number.isFinite(cell1) ||
        !Number.isFinite(pack) ||
        !Number.isFinite(cell2)
    ) {
        return;
    }
    const difference = Math.abs(cell1 - cell2);
    if (batteryPackValue) {
        batteryPackValue.textContent =
            formatNumber(pack, 2) + " V";
    }
    if (batteryCell1Value) {
        batteryCell1Value.textContent =
            formatNumber(cell1, 2) + " V";
    }
    if (batteryCell2Value) {
        batteryCell2Value.textContent =
            formatNumber(cell2, 2) + " V";
    }
    if (batteryDifferenceValue) {
        batteryDifferenceValue.textContent =
            formatNumber(difference, 2) + " V";
    }
    const status =
        (pack < 7.0 || cell1 < 3.5 || cell2 < 3.5)
            ? "LOW"
            : "OK";
    if (batteryStatusValue) {
        batteryStatusValue.textContent = status;
        batteryStatusValue.className =
            status === "OK"
                ? "battery-status ok"
                : "battery-status low";
    }
    // Aktualizacja pionowego wskaźnika baterii.
    updateBatteryLevel(pack);
    if (batteryUpdatedValue) {
        batteryUpdatedValue.textContent =
            "Updated: " + new Date().toLocaleTimeString();
    }
}
// ========================================================
// HANDLE SENSOR READY
// ========================================================
async function handleSensorReady() {
    sensorReady = true;
    lastHeartbeatTime =
        Date.now();
    // Resolve waiting connection.
    if (
        typeof window.__gazelaReadyWaiter ===
        "function"
    ) {
        const waiter =
            window.__gazelaReadyWaiter;
        window.__gazelaReadyWaiter =
            null;
        waiter();
    }
    // ----------------------------------------------------
    // AFTER MEASUREMENT
    // ----------------------------------------------------
    //
    // END,ALL_MOVEMENTS
    // READY
    // L
    // LIVE
    // ----------------------------------------------------
    if (
        returnToLiveAfterReady &&
        bleTransport
    ) {
        returnToLiveAfterReady =
            false;
        try {
            await startLiveMode();
        }
        catch (error) {
            console.error(
                "Automatic return to LIVE failed:",
                error
            );
        }
    }
}
// ========================================================
// PARSE LIVE DATA
// ========================================================
function parseLiveData(line) {
    const parts = line.split(",");
    // V25: LIVE,AX,AY,AZ,G,Angle,GX,GY,GZ,AngleY,SEQ,FIFO_SEQ
    // SEQ and FIFO_SEQ are optional for backward compatibility.
    if (parts.length < 10 || parts[0] !== "LIVE") {
        return;
    }
    const AX = parseFloat(parts[1]);
    const AY = parseFloat(parts[2]);
    const AZ = parseFloat(parts[3]);
    const G = parseFloat(parts[4]);
    const Angle = parseFloat(parts[5]);
    const GX = parseFloat(parts[6]);
    const GY = parseFloat(parts[7]);
    const GZ = parseFloat(parts[8]);
    const AngleY = parseFloat(parts[9]);
    const frameSequence =
        parts.length > 10 && parts[10] !== ""
            ? Number(parts[10])
            : null;
    const fifoSequence =
        parts.length > 11 && parts[11] !== ""
            ? Number(parts[11])
            : null;
    if (![AX, AY, AZ, G, Angle, GX, GY, GZ, AngleY]
        .every(Number.isFinite)) {
        return;
    }
    // Track firmware sequence metadata without rejecting valid sensor samples.
    if (Number.isInteger(frameSequence) && frameSequence >= 0) {
        if (lastLiveFrameSequence !== null) {
            const delta =
                (frameSequence - lastLiveFrameSequence) >>> 0;
            if (delta > 1 && delta < 0x80000000) {
                liveSequenceGapCount += delta - 1;
            }
        }
        lastLiveFrameSequence = frameSequence >>> 0;
    }
    if (Number.isInteger(fifoSequence) && fifoSequence >= 0) {
        if (lastLiveFifoSequence !== null) {
            const delta =
                (fifoSequence - lastLiveFifoSequence) >>> 0;
            // FIFO runs at 100 Hz while LIVE is sent at about 50 Hz.
            // A FIFO_SEQ delta of 2 is therefore the expected cadence,
            // not a lost LIVE packet. Count only excess jumps.
            if (delta > 2 && delta < 0x80000000) {
                fifoSequenceGapCount += delta - 2;
            }
        }
        lastLiveFifoSequence = fifoSequence >>> 0;
    }
    lastHeartbeatTime = Date.now();
    if (axValue) axValue.textContent = formatNumber(AX);
    if (ayValue) ayValue.textContent = formatNumber(AY);
    if (azValue) azValue.textContent = formatNumber(AZ);
    if (gValue) gValue.textContent = formatNumber(G);
    if (angleValue) angleValue.textContent = formatNumber(Angle, 1);
    if (gxValue) gxValue.textContent = formatNumber(GX);
    if (gyValue) gyValue.textContent = formatNumber(GY);
    if (gzValue) gzValue.textContent = formatNumber(GZ);
    if (angleyValue) angleyValue.textContent = formatNumber(AngleY, 1);
    // Feed the manual gesture recorder from the existing LIVE stream.
    // This is local browser-side processing only; no Arduino command is sent.
    gestureReceiveSample({
        AX, AY, AZ, G, Angle, GX, GY, GZ, AngleY,
        SEQ: frameSequence,
        FIFO_SEQ: fifoSequence
    });
}
// ========================================================
// PROCESS SENSOR LINE
// ========================================================
// SENSOR MESSAGE ROUTER - EXPLICIT TRANSPORT SOURCE
function routeSensorMessage(source, line) {
    if (!line) {
        return;
    }
    const messageType = classifySensorMessage(source, line);
    processSerialLine(line, source, messageType);
}
// ========================================================
function processSerialLine(line, source, messageType) {
    if (!line) {
        return;
    }
    if (source === "ble" && line.startsWith("CAP,")) { contactReceiveStatus(line); return; }
    // ====================================================
    // SERIAL MONITOR
    // ====================================================
    // Classify and route the message using its actual transport source.
    routeServiceDiagnosticLine(line, source, messageType);
    if (!isSensorDataLine(line)) {
        addSerialLine(line);
    }
    // V51: USB may feed USER MODE LIVE only when it is the active fallback.
    // Every other USB message remains diagnostics-only and read-only.
    if (source === "usb") {
        if (line.startsWith("LIVE,") && activeDataSource === "usb") {
            parseLiveData(line);
        }
        return;
    }
    if (source !== "ble") {
        return;
    }
    // ====================================================
    // HEARTBEAT
    // ====================================================
    if (
        line ===
        "HEARTBEAT"
    ) {
        lastHeartbeatTime =
            Date.now();
        sensorReady =
            true;
        if (
            typeof window.__gazelaReadyWaiter ===
            "function"
        ) {
            const waiter =
                window.__gazelaReadyWaiter;
            window.__gazelaReadyWaiter =
                null;
            waiter();
        }
        if (
            returnToLiveAfterReady &&
            sensorTransport &&
            source === "ble"
        ) {
            returnToLiveAfterReady =
                false;
            startLiveMode()
                .catch(
                    error => {
                        console.error(
                            "Automatic return to LIVE failed:",
                            error
                        );
                    }
                );
        }
        if (!measuring) {
            setStatus(
                "Sensor ready",
                "connected"
            );
        }
        // V40:
        // HEARTBEAT is the current USB readiness signal.
        // V39 set sensorReady=true but did not enable START.
        if (startButton) {
            startButton.disabled = (source !== "ble");
        }
        if (stopButton && !measuring) {
            stopButton.disabled = true;
        }
        if (measurementStatus && !measuring) {
            measurementStatus.textContent =
                "Sensor ready.";
            measurementStatus.className =
                "measurement-status";
        }
        return;
    }
    // ====================================================
    // READY
    // ====================================================
    if (
        line ===
        "READY"
    ) {
        measuring = false;
        handleSensorReady();
        if (measurementStatus) {
            measurementStatus.textContent =
                "Sensor ready.";
            measurementStatus.className =
                "measurement-status";
        }
        if (startButton) {
            startButton.disabled = (source !== "ble");
        }
        if (stopButton) {
            stopButton.disabled =
                true;
        }
        return;
    }
    // ====================================================
    // BLE READY
    // ====================================================
    if (
        line ===
        "BLE READY"
    ) {
        sensorReady =
            true;
        lastHeartbeatTime =
            Date.now();
        if (
            typeof window.__gazelaReadyWaiter ===
            "function"
        ) {
            const waiter =
                window.__gazelaReadyWaiter;
            window.__gazelaReadyWaiter =
                null;
            waiter();
        }
        return;
    }
    // ====================================================
    // LIVE MODE
    // ====================================================
    if (
        line ===
        "INFO,LIVE_MODE"
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
            startButton.disabled =
                false;
        }
        if (stopButton) {
            stopButton.disabled =
                true;
        }
        return;
    }
    // ====================================================
    // LIVE START
    // ====================================================
    if (
        line ===
        "INFO,LIVE_START"
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
            startButton.disabled =
                false;
        }
        if (stopButton) {
            stopButton.disabled =
                true;
        }
        return;
    }
    // ====================================================
    // LIVE STOP
    // ====================================================
    if (
        line ===
        "INFO,LIVE_STOP"
    ) {
        return;
    }
    // ====================================================
    // MEASUREMENT START
    // ====================================================
    if (
        line ===
        "INFO,START"
    ) {
        /*
         * INFO,START is accepted only when this page
         * explicitly sent command S.
         *
         * This prevents CONNECT -> L -> INFO,START
         * from accidentally starting a measurement.
         */
        if (!measurementCommandSent) {
            return;
        }
        measurementCommandSent =
            false;
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
            startButton.disabled =
                true;
        }
        if (stopButton) {
            stopButton.disabled =
                false;
        }
        return;
    }
    // ====================================================
    // PREPARE
    // ====================================================
    if (
        line ===
        "INFO,PREPARE"
    ) {
        if (measurementStatus) {
            measurementStatus.textContent =
                "Preparing measurement...";
            measurementStatus.className =
                "measurement-status active";
        }
        return;
    }
    // ====================================================
    // COUNTDOWN
    // ====================================================
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
    // ====================================================
    // MOVEMENT
    // ====================================================
    if (
        line.startsWith(
            "MOVEMENT,"
        )
    ) {
        const parts =
            line.split(",");
        if (
            parts.length >= 2
        ) {
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
    // ====================================================
    // WAIT
    // ====================================================
    if (
        line ===
        "INFO,WAIT"
    ) {
        return;
    }
    // ====================================================
    // WAIT AFTER MOVEMENT
    // ====================================================
    if (
        line.startsWith(
            "INFO,WAIT_AFTER_MOVEMENT_"
        )
    ) {
        return;
    }
    // ====================================================
    // MOVEMENT COMPLETE
    // ====================================================
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
    // ====================================================
    // CSV HEADER
    // ====================================================
    if (
        line.startsWith(
            "MOVEMENT,TIME_ms"
        )
    ) {
        return;
    }
    // ====================================================
    // CSV SAMPLE
    // ====================================================
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
        if (
            parts.length >= 11
        ) {
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
    // ====================================================
    // END OF SESSION
    // ====================================================
    if (
        line ===
        "END,ALL_MOVEMENTS"
    ) {
        finishSession();
        return;
    }
    // ====================================================
    // BATTERY DATA
    // ====================================================
    if (line.startsWith("BAT,")) {
        parseBatteryData(line);
        return;
    }
// ====================================================
    // LIVE DATA
    // ====================================================
    if (
        line.startsWith(
            "LIVE,"
        )
    ) {
        // V47: LIVE itself proves that the sensor is reachable and already
        // running. After USB reconnect the firmware may remain in LIVE and
        // may not emit a new HEARTBEAT/READY transition.
        if (waitingForInitialReady) {
            liveDetectedDuringInitialConnect =
                true;
            sensorReady =
                true;
            if (typeof window.__gazelaReadyWaiter ===
                "function") {
                const waiter =
                    window.__gazelaReadyWaiter;
                window.__gazelaReadyWaiter =
                    null;
                waiter();
            }
        }
        parseLiveData(line);
        return;
    }
}
// ========================================================
// SEND COMMAND
// ========================================================
async function sendCommand(command) {
    if (!bleTransport) throw new Error("Komendy treningowe są dostępne wyłącznie przez BLE.");
    await bleTransport.send(command);
    addSerialLine("> " + command, "serial-command");
}
// ========================================================
// START LIVE MODE
// ========================================================
async function startLiveMode() {
    if (!bleTransport) return;
    try {
        await sendCommand("L");
        measuring = false;
        lastHeartbeatTime = Date.now();
        setStatus("Live sensor", "connected");
        if (measurementStatus) { measurementStatus.textContent = "Live sensor mode active."; measurementStatus.className = "measurement-status active"; }
        if (startButton) startButton.disabled = false;
        if (stopButton) stopButton.disabled = true;
    } catch (error) {
        console.error("LIVE error:", error);
        setStatus("Live mode error", "error");
        if (measurementStatus) { measurementStatus.textContent = "Unable to start LIVE mode."; measurementStatus.className = "measurement-status"; }
        addSerialLine("LIVE ERROR: " + error.message, "serial-error");
        throw error;
    }
}
// ========================================================
// V50 — UNEXPECTED TRANSPORT END RECOVERY
// ========================================================
async function handleUnexpectedTransportEnd(transport, reason, kind) {
    const actualKind = kind || (transport === bleTransport ? "ble" : transport === usbTransport ? "usb" : null);
    if (!transport || !actualKind) return;
    if (actualKind === "ble" && bleTransport !== transport) return;
    if (actualKind === "usb" && usbTransport !== transport) return;
    addSerialLine("V51: unexpected " + actualKind.toUpperCase() + " transport end (" + reason + ").", "serial-error");
    await disconnectSensor(actualKind, true);
    if (actualKind === "usb" && serviceConnectionStatus && isServiceModeOpen()) serviceConnectionStatus.textContent = "USB zostało rozłączone. Możesz ponownie nacisnąć CONNECT USB — BLE działa niezależnie.";
    addSerialLine("V51: " + actualKind.toUpperCase() + " transport state reset complete.", "serial-info");
}
// ========================================================
// CONNECT SENSOR
// ========================================================
function resetLiveSequenceTracking() {
    lastLiveFrameSequence = null;
    lastLiveFifoSequence = null;
}
function syncTransportState(reason = "state-change") {
    const nextSource = bleTransport ? "ble" : usbTransport ? "usb" : null;
    if (nextSource !== activeDataSource) {
        activeDataSource = nextSource;
        resetLiveSequenceTracking();
        addSerialLine("V51: LIVE source = " + (activeDataSource || "none") + " (" + reason + ")", "serial-info");
    }
    sensorTransport = bleTransport || usbTransport || null;
    transportType = bleTransport ? bleTransport.name : usbTransport ? usbTransport.name : null;
    if (connectButton) connectButton.disabled = !!bleTransport || bleConnecting;
    if (disconnectButton) disconnectButton.disabled = !bleTransport;
    if (startButton) startButton.disabled = !bleTransport || measuring;
    if (stopButton) stopButton.disabled = !bleTransport || !measuring;
    if (activeDataSource === "ble") {
        setTransportStatus("Transport: BLE active" + (usbTransport ? " | USB diagnostics connected" : ""));
        if (!measuring) setStatus("Live sensor", "connected");
    } else if (activeDataSource === "usb") {
        setTransportStatus("Transport: USB LIVE fallback (read only)");
        if (!measuring) setStatus("Live sensor (USB)", "connected");
    } else {
        setTransportStatus("Transport: not connected");
        if (!bleConnecting && !usbConnecting) setStatus("Sensor not connected", "neutral");
    }
    gestureUpdateUI();
    if (typeof contactRefresh === "function") contactRefresh();
}
async function connectSensor(kind = selectedTransport) {
    if (kind === "usb" && !isServiceModeOpen()) { addSerialLine("USB CONNECT BLOCKED: SERVICE MODE is closed.", "serial-error"); return; }
    if (kind === "ble" && (bleTransport || bleConnecting)) return;
    if (kind === "usb" && (usbTransport || usbConnecting)) return;
    if (kind === "ble") bleConnecting = true; else usbConnecting = true;
    let candidate = null;
    try {
        candidate = await createSensorTransport(kind);
        await candidate.connect();
        if (kind === "ble") bleTransport = candidate; else usbTransport = candidate;
        syncTransportState("connect-" + kind);
        addSerialLine("V51: " + kind.toUpperCase() + " connected: " + candidate.name, "serial-info");
        if (kind === "ble") {
            sensorReady = true;
            waitingForInitialReady = false;
            returnToLiveAfterReady = false;
            measurementCommandSent = false;
            startHeartbeatMonitor();
            await startLiveMode();
        } else {
            routeServiceDiagnosticLine("USB CONNECTED: " + candidate.name + " (115200 baud, READ ONLY)", "usb");
            if (measurementStatus && !bleTransport) { measurementStatus.textContent = "USB LIVE fallback active when BLE is disconnected. USB remains read-only."; measurementStatus.className = "measurement-status active"; }
        }
        syncTransportState("connected-" + kind);
    } catch (error) {
        console.error("Connection error (" + kind + "):", error);
        if (candidate) { try { await candidate.disconnect(); } catch (disconnectError) { console.warn(disconnectError); } }
        if (kind === "ble" && bleTransport === candidate) bleTransport = null;
        if (kind === "usb" && usbTransport === candidate) usbTransport = null;
        if (kind === "ble") { sensorReady = false; waitingForInitialReady = false; returnToLiveAfterReady = false; measurementCommandSent = false; stopHeartbeatMonitor(); }
        syncTransportState("connect-failed-" + kind);
        setStatus("Connection failed", "error");
        addSerialLine("CONNECT " + kind.toUpperCase() + " ERROR: " + error.message, "serial-error");
    } finally {
        if (kind === "ble") bleConnecting = false; else usbConnecting = false;
        syncTransportState("connect-finished-" + kind);
    }
}
// ========================================================
// START MEASUREMENT
// ========================================================
async function startMeasurement() {
    if (!bleTransport) {
        setStatus(
            "Training requires BLE",
            "error"
        );
        if (measurementStatus) {
            measurementStatus.textContent =
                "USB is read-only. Connect through BLE to record movements.";
            measurementStatus.className =
                "measurement-status";
        }
        addSerialLine(
            "V51: measurement blocked — BLE is not connected.",
            "serial-info"
        );
        return;
    }
        // ----------------------------------------------------
    // BLE TRAINING MEASUREMENT
    // ----------------------------------------------------
    try {
        measuring = true;
        sampleCount = 0;
        currentMovement = 0;
        sessionStartTime =
            Date.now();
        sessionEndTime = null;
        returnToLiveAfterReady =
            false;
        /*
         * Authorize INFO,START only for this explicit
         * START button action.
         */
        measurementCommandSent =
            true;
        if (samplesValue) {
            samplesValue.textContent =
                "0";
        }
        if (movementValue) {
            movementValue.textContent =
                "--";
        }
        if (timeValue) {
            timeValue.textContent =
                "--";
        }
        if (movementList) {
            movementList.innerHTML =
                "";
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
            startButton.disabled =
                true;
        }
        if (stopButton) {
            stopButton.disabled =
                false;
        }
        await sendCommand(
            "S"
        );
    }
    catch (error) {
        console.error(
            "Measurement start error:",
            error
        );
        measuring = false;
        measurementCommandSent =
            false;
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
            startButton.disabled =
                false;
        }
        if (stopButton) {
            stopButton.disabled =
                true;
        }
    }
}
// ========================================================
// FINISH SESSION
// ========================================================
function finishSession() {
    measuring = false;
    measurementCommandSent =
        false;
    sessionEndTime =
        Date.now();
    returnToLiveAfterReady =
        true;
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
            "Five movements completed. Waiting for sensor READY...";
        measurementStatus.className =
            "measurement-status active";
    }
    if (startButton) {
        startButton.disabled =
            true;
    }
    if (stopButton) {
        stopButton.disabled =
            true;
    }
    // NO setTimeout().
    //
    // Arduino will send READY.
    // In V48, only BLE may trigger the automatic return to LIVE.
}
// ========================================================
// STOP MEASUREMENT
// ========================================================
async function stopMeasurement() {
    if (!bleTransport) {
        if (measurementStatus) {
            measurementStatus.textContent =
                "USB is read-only. Training STOP is available through BLE.";
        }
        addSerialLine(
            "V51: STOP blocked — BLE is not connected.",
            "serial-info"
        );
        return;
    }
    try {
        measuring = false;
        measurementCommandSent =
            false;
        // Manual STOP follows the same state machine as the
        // natural end of a measurement:
        // Q -> READY/HEARTBEAT -> L -> LIVE.
        returnToLiveAfterReady =
            true;
        await sendCommand(
            "Q"
        );
        if (measurementStatus) {
            measurementStatus.textContent =
                "Stopping... Waiting for sensor READY...";
            measurementStatus.className =
                "measurement-status active";
        }
        setStatus(
            "Stopping measurement",
            "connected"
        );
        if (startButton) {
            startButton.disabled =
                true;
        }
        if (stopButton) {
            stopButton.disabled =
                true;
        }
    }
    catch (error) {
        console.error(
            "Stop measurement error:",
            error
        );
        returnToLiveAfterReady =
            false;
        setStatus(
            "Stop error",
            "error"
        );
        addSerialLine(
            "STOP ERROR: " +
            error.message,
            "serial-error"
        );
    }
}
// ========================================================
// DISCONNECT SENSOR
// ========================================================
async function disconnectSensor(kind = "ble", unexpected = false) {
    if (kind === "ble" || kind === "all") contactDisconnected();
    const targets = kind === "all" ? ["ble", "usb"] : [kind];
    for (const target of targets) {
        const transport = target === "ble" ? bleTransport : usbTransport;
        if (!transport) continue;
        if (target === "ble") { bleTransport = null; stopHeartbeatMonitor(); sensorReady = false; measuring = false; waitingForInitialReady = false; returnToLiveAfterReady = false; measurementCommandSent = false; }
        else usbTransport = null;
        try { await transport.disconnect(); } catch (error) { console.warn("Disconnect " + target + " error:", error); }
    }
    syncTransportState("disconnect-" + kind);
    if (!unexpected && measurementStatus && !bleTransport) { measurementStatus.textContent = usbTransport ? "USB LIVE fallback is read-only. Connect BLE for training." : "Sensor disconnected."; measurementStatus.className = "measurement-status"; }
    if (serviceConnectionStatus && isServiceModeOpen()) serviceConnectionStatus.textContent = usbTransport ? "USB diagnostyczne pozostaje połączone." : "USB rozłączone. BLE działa niezależnie.";
    addSerialLine("V51: disconnect completed for " + kind + ".", "serial-info");
}
// ========================================================
// SELECT USB — SERVICE / DIAGNOSTICS
// ========================================================
function selectUSBTransport() {
    if (!isServiceModeOpen()) { addSerialLine("USB transport is locked until SERVICE MODE is opened.", "serial-error"); return; }
    selectedTransport = "usb";
    if (usbButton) usbButton.classList.add("active");
    if (bleButton) bleButton.classList.remove("active");
    if (!usbTransport) setTransportStatus(bleTransport ? "Transport: BLE active" : "Transport: USB selected");
}
// ========================================================
// SELECT BLE — ATHLETE / TRAINING
// ========================================================
function selectBLETransport() {
    selectedTransport = "ble";
    if (bleButton) bleButton.classList.add("active");
    if (usbButton) usbButton.classList.remove("active");
    if (!bleTransport) setTransportStatus(usbTransport ? "Transport: USB LIVE fallback" : "Transport: BLE selected");
}
// ========================================================
// V51 — INDEPENDENT BLE + USB CONTROLS
// ========================================================
if (usbButton) {
    usbButton.addEventListener("click", async () => {
        if (!isServiceModeOpen()) return;
        selectUSBTransport();
        if (usbTransport) { if (serviceConnectionStatus) serviceConnectionStatus.textContent = "USB jest już połączone — diagnostyka aktywna."; return; }
        if (serviceConnectionStatus) serviceConnectionStatus.textContent = "Otwieranie wyboru portu USB…";
        await connectSensor("usb");
        if (serviceConnectionStatus) serviceConnectionStatus.textContent = usbTransport ? "USB aktywne — kanał read-only; LIVE działa jako fallback bez BLE." : "Nie udało się połączyć USB. Spróbuj ponownie.";
    });
}
if (bleButton) bleButton.addEventListener("click", () => selectBLETransport());
if (serviceModeToggle && serviceModeContent) {
    serviceModeToggle.addEventListener("click", async () => {
        const isOpen = serviceModeToggle.getAttribute("aria-expanded") === "true";
        const description = serviceModeToggle.querySelector(".service-toggle-description");
        if (isOpen) {
            if (usbTransport || usbConnecting) await disconnectSensor("usb");
            serviceModeToggle.setAttribute("aria-expanded", "false");
            serviceModeContent.hidden = true;
            if (description) description.textContent = "Otwórz moduły diagnostyczne i uzyskaj dostęp do USB.";
            return;
        }
        serviceModeToggle.setAttribute("aria-expanded", "true");
        serviceModeContent.hidden = false;
        if (description) description.textContent = "Moduły diagnostyczne są dostępne. Połącz USB, aby odczytać dane serwisowe.";
        if (serviceConnectionStatus) serviceConnectionStatus.textContent = bleTransport ? "BLE USER MODE działa. USB można podłączyć równolegle jako diagnostykę." : "SERVICE MODE aktywny. Naciśnij CONNECT USB.";
    });
}
if (connectButton) connectButton.addEventListener("click", async () => { selectBLETransport(); await connectSensor("ble"); });
if (disconnectButton) disconnectButton.addEventListener("click", () => disconnectSensor("ble"));
if (startButton) startButton.addEventListener("click", startMeasurement);
if (stopButton) stopButton.addEventListener("click", stopMeasurement);
// ========================================================
// INITIAL TRANSPORT — BLE is the default user selection.
// ========================================================
selectBLETransport();
// ========================================================
// INITIAL STATUS
// ========================================================
setStatus(
    "Sensor not connected",
    "neutral"
);
setTransportStatus(
    "Transport: BLE selected"
);
resetLiveValues();
resetBatteryValues();
// ========================================================
// DEBUG ACCESS
// ========================================================
window.gazelaSensor = {
    getTransport: () => sensorTransport,
    getTransportType: () => transportType,
    getSelectedTransport: () => selectedTransport,
    getActiveDataSource: () => activeDataSource,
    getBLETransport: () => bleTransport,
    getUSBTransport: () => usbTransport,
    send: sendCommand
};
// ========================================================
// END OF APP.JS
// ========================================================
// ========================================================
// GESTURE RECORDER / COMPARATOR — BROWSER SIDE ONLY
// ========================================================
// Receives the already validated LIVE samples. It does not send
// L, S, Q or any other command and does not change firmware protocol.
// The reference is stored locally in this browser's localStorage.
// ========================================================
const GESTURE_MAX_SAMPLES = 1500;
const GESTURE_COMPARE_POINTS = 64;
const GESTURE_REFERENCE_KEY = "gazelaGestureReferenceV1";
const GESTURE_CHANNELS = ["AX", "AY", "AZ", "GX", "GY", "GZ"];
let gestureRecording = false;
let gestureCurrentBuffer = [];
let gestureCompletedRecording = null;
let gestureReference = null;
let gestureHistoryItems = [];
let gestureRecordingStartedAt = 0;
let gestureLastDrawAt = 0;
const gestureElements = {
  badge: document.getElementById("gestureStatusBadge"),
  buffer: document.getElementById("gestureBufferCount"),
  duration: document.getElementById("gestureDuration"),
  samples: document.getElementById("gestureSampleCount"),
  reference: document.getElementById("gestureReferenceStatus"),
  record: document.getElementById("gestureRecordButton"),
  stop: document.getElementById("gestureStopButton"),
  save: document.getElementById("gestureReferenceButton"),
  compare: document.getElementById("gestureCompareButton"),
  clear: document.getElementById("gestureClearButton"),
  message: document.getElementById("gestureMessage"),
  accelerationCanvas: document.getElementById("gestureAccelerationChart"),
  gyroscopeCanvas: document.getElementById("gestureGyroscopeChart"),
  score: document.getElementById("gestureMatchScore"),
  description: document.getElementById("gestureMatchDescription"),
  history: document.getElementById("gestureHistory")
};
function gestureSetMessage(message, active = false) {
  if (!gestureElements.message) return;
  gestureElements.message.textContent = message;
  gestureElements.message.className = active
    ? "measurement-status active"
    : "measurement-status";
}
function gestureSetBadge(text, state = "") {
  if (!gestureElements.badge) return;
  gestureElements.badge.textContent = text;
  gestureElements.badge.className = "gesture-status-badge";
  if (state) gestureElements.badge.classList.add(state);
}
function gestureLoadReference() {
  try {
    const raw = localStorage.getItem(GESTURE_REFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.samples) || parsed.samples.length < 2) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Gesture reference could not be loaded:", error);
    return null;
  }
}
function gestureUpdateUI() {
  const count = gestureCurrentBuffer.length;
  const duration = count > 1
    ? (gestureCurrentBuffer[count - 1].t - gestureCurrentBuffer[0].t) / 1000
    : 0;
  if (gestureElements.buffer) gestureElements.buffer.textContent = String(count);
  if (gestureElements.duration) gestureElements.duration.textContent = duration.toFixed(2) + " s";
  if (gestureElements.samples) gestureElements.samples.textContent = String(count);
  if (gestureElements.reference) {
    gestureElements.reference.textContent = gestureReference ? "Saved" : "Not saved";
  }
  if (gestureElements.record) {
    gestureElements.record.disabled = gestureRecording || !activeDataSource;
  }
  if (gestureElements.stop) gestureElements.stop.disabled = !gestureRecording;
  if (gestureElements.save) gestureElements.save.disabled = gestureRecording || !gestureCompletedRecording || gestureCompletedRecording.length < 2;
  if (gestureElements.compare) {
    gestureElements.compare.disabled = gestureRecording || !gestureReference || !gestureCompletedRecording;
  }
  if (gestureElements.clear) gestureElements.clear.disabled = gestureRecording;
  if (!gestureRecording && !activeDataSource) {
    gestureSetBadge("Waiting for LIVE");
  } else if (!gestureRecording && activeDataSource) {
    gestureSetBadge("Sensor connected", "ready");
  }
}
function gestureReceiveSample(sample) {
  if (!gestureRecording || !sample) return;
  const values = {};
  for (const key of GESTURE_CHANNELS) {
    const value = Number(sample[key]);
    if (!Number.isFinite(value)) return;
    values[key] = value;
  }
  const now = performance.now();
  gestureCurrentBuffer.push({
    t: now - gestureRecordingStartedAt,
    ...values
  });
  if (gestureCurrentBuffer.length > GESTURE_MAX_SAMPLES) {
    gestureCurrentBuffer.shift();
    const offset = gestureCurrentBuffer[0].t;
    gestureCurrentBuffer.forEach(point => { point.t -= offset; });
    gestureRecordingStartedAt = now - gestureCurrentBuffer[0].t;
  }
  if (now - gestureLastDrawAt >= 100) {
    gestureLastDrawAt = now;
    gestureUpdateUI();
    gestureDrawCharts(gestureCurrentBuffer);
  }
}
function gestureStartRecording() {
  if (!activeDataSource) {
    gestureSetMessage("Najpierw połącz sensor. Rejestracja korzysta z istniejącego strumienia LIVE.");
    return;
  }
  if (gestureRecording) return;
  gestureCurrentBuffer = [];
  gestureRecordingStartedAt = performance.now();
  gestureLastDrawAt = 0;
  gestureRecording = true;
  if (gestureElements.score) gestureElements.score.textContent = "—";
  if (gestureElements.description) {
    gestureElements.description.textContent = "Nagrywanie gestu. Wykonaj ruch i naciśnij STOP.";
  }
  gestureSetBadge("Recording", "recording");
  gestureSetMessage("Trwa ręczna rejestracja danych LIVE…", true);
  gestureUpdateUI();
  gestureDrawCharts([]);
}
function gestureStopRecording() {
  if (!gestureRecording) return;
  gestureRecording = false;
  if (gestureCurrentBuffer.length >= 2) {
    // Keep the completed take separate so a later recording cannot overwrite it.
    gestureCompletedRecording = gestureCurrentBuffer.map(point => ({ ...point }));
    const duration = (gestureCompletedRecording.at(-1).t - gestureCompletedRecording[0].t) / 1000;
    gestureHistoryItems.unshift({
      id: Date.now(),
      count: gestureCompletedRecording.length,
      duration,
      label: "Gesture " + (gestureHistoryItems.length + 1)
    });
    gestureHistoryItems = gestureHistoryItems.slice(0, 10);
    gestureRenderHistory();
    gestureSetBadge("Recording complete", "ready");
    gestureSetMessage("Zapisano gest: " + gestureCompletedRecording.length + " próbek, " + duration.toFixed(2) + " s.");
    gestureDrawCharts(gestureCompletedRecording);
  } else {
    gestureCompletedRecording = null;
    gestureSetBadge("Too few samples");
    gestureSetMessage("Za mało próbek. Sprawdź, czy sensor wysyła dane LIVE i spróbuj ponownie.");
    gestureDrawCharts([]);
  }
  gestureUpdateUI();
}
function gestureSaveReference() {
  if (!gestureCompletedRecording || gestureCompletedRecording.length < 2) return;
  const reference = {
    version: 1,
    savedAt: new Date().toISOString(),
    samples: gestureResample(gestureCompletedRecording, GESTURE_COMPARE_POINTS)
  };
  try {
    localStorage.setItem(GESTURE_REFERENCE_KEY, JSON.stringify(reference));
    gestureReference = reference;
    gestureSetMessage("Gest referencyjny zapisany lokalnie w tej przeglądarce.");
    gestureUpdateUI();
  } catch (error) {
    console.error("Could not save gesture reference:", error);
    gestureSetMessage("Nie udało się zapisać wzorca. Sprawdź dostępność pamięci lokalnej przeglądarki.");
  }
}
function gestureResample(samples, targetCount) {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const firstT = samples[0].t;
  const lastT = samples[samples.length - 1].t;
  const duration = Math.max(1, lastT - firstT);
  const output = [];
  for (let i = 0; i < targetCount; i++) {
    const targetT = firstT + duration * i / (targetCount - 1);
    let right = samples.findIndex(point => point.t >= targetT);
    if (right < 0) right = samples.length - 1;
    const left = Math.max(0, right - 1);
    const a = samples[left];
    const b = samples[right];
    const span = b.t - a.t;
    const ratio = span > 0 ? (targetT - a.t) / span : 0;
    const point = { t: i / (targetCount - 1) };
    for (const key of GESTURE_CHANNELS) {
      point[key] = a[key] + (b[key] - a[key]) * ratio;
    }
    output.push(point);
  }
  return output;
}
function gestureCompare() {
  if (!gestureReference || !gestureCompletedRecording) return;
  const current = gestureResample(gestureCompletedRecording, GESTURE_COMPARE_POINTS);
  const reference = gestureReference.samples;
  if (current.length !== reference.length || current.length < 2) return;
  let totalError = 0;
  let totalReferenceEnergy = 0;
  let channelCount = 0;
  for (const channel of GESTURE_CHANNELS) {
    const refValues = reference.map(point => Number(point[channel]));
    const curValues = current.map(point => Number(point[channel]));
    const refMean = refValues.reduce((sum, value) => sum + value, 0) / refValues.length;
    const curMean = curValues.reduce((sum, value) => sum + value, 0) / curValues.length;
    const refScale = Math.sqrt(refValues.reduce((sum, value) => sum + (value - refMean) ** 2, 0) / refValues.length) || 1;
    const curScale = Math.sqrt(curValues.reduce((sum, value) => sum + (value - curMean) ** 2, 0) / curValues.length) || 1;
    for (let i = 0; i < GESTURE_COMPARE_POINTS; i++) {
      const normalizedRef = (refValues[i] - refMean) / refScale;
      const normalizedCur = (curValues[i] - curMean) / curScale;
      totalError += (normalizedRef - normalizedCur) ** 2;
      totalReferenceEnergy += normalizedRef ** 2;
    }
    channelCount++;
  }
  const rmse = Math.sqrt(totalError / (channelCount * GESTURE_COMPARE_POINTS));
  const similarity = Math.max(0, Math.min(100, Math.round(100 * Math.exp(-rmse / 2))));
  if (gestureElements.score) gestureElements.score.textContent = similarity + "/100";
  if (gestureElements.description) {
    gestureElements.description.textContent =
      "Wstępne podobieństwo kształtu sygnałów: " + similarity +
      "/100. Porównanie obejmuje AX, AY, AZ, GX, GZ i GY po normalizacji i resamplingu do 64 punktów.";
  }
  gestureSetMessage("Porównanie zakończone. Wynik traktuj jako wskaźnik eksperymentalny, nie ocenę jakości techniki.");
}
function gestureClearCurrent() {
  if (gestureRecording) return;
  gestureCurrentBuffer = [];
  gestureCompletedRecording = null;
  if (gestureElements.score) gestureElements.score.textContent = "—";
  if (gestureElements.description) {
    gestureElements.description.textContent = "Zarejestruj gest i zapisz ruch referencyjny, aby rozpocząć porównanie.";
  }
  gestureSetMessage("Bieżące nagranie wyczyszczone. Wzorzec referencyjny pozostaje zapisany.");
  gestureDrawCharts([]);
  gestureUpdateUI();
}
function gestureRenderHistory() {
  if (!gestureElements.history) return;
  gestureElements.history.replaceChildren();
  if (!gestureHistoryItems.length) {
    const empty = document.createElement("div");
    empty.className = "gesture-history-empty";
    empty.textContent = "Brak zakończonych nagrań.";
    gestureElements.history.appendChild(empty);
    return;
  }
  gestureHistoryItems.forEach(item => {
    const row = document.createElement("div");
    row.className = "gesture-history-item";
    const label = document.createElement("span");
    label.textContent = item.label + " — " + item.count + " próbek, " + item.duration.toFixed(2) + " s";
    const status = document.createElement("span");
    status.textContent = "Saved in current page session";
    row.append(label, status);
    gestureElements.history.appendChild(row);
  });
}
function gestureDrawSingleChart(canvas, samples, channels) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || 600));
  const height = 190;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const y = height * i / 5;
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(width - 10, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#64748b";
  ctx.font = "11px Arial";
  ctx.fillText("LIVE samples", 34, 13);
  if (!samples || samples.length < 2) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px Arial";
    ctx.fillText("No recorded gesture", 34, height / 2);
    return;
  }
  const colors = ["#2563eb", "#16a34a", "#dc2626"];
  const values = channels.flatMap(channel => samples.map(point => point[channel]).filter(Number.isFinite));
  if (!values.length) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.0001, max - min);
  const plotTop = 22;
  const plotBottom = height - 18;
  channels.forEach((channel, channelIndex) => {
    ctx.strokeStyle = colors[channelIndex];
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    samples.forEach((point, index) => {
      const x = 34 + (width - 46) * index / (samples.length - 1);
      const y = plotBottom - ((point[channel] - min) / range) * (plotBottom - plotTop);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = colors[channelIndex];
    ctx.fillText(channel, 36 + channelIndex * 48, height - 3);
  });
}
function gestureDrawCharts(samples) {
  gestureDrawSingleChart(gestureElements.accelerationCanvas, samples, ["AX", "AY", "AZ"]);
  gestureDrawSingleChart(gestureElements.gyroscopeCanvas, samples, ["GX", "GY", "GZ"]);
}
if (gestureElements.record) gestureElements.record.addEventListener("click", gestureStartRecording);
if (gestureElements.stop) gestureElements.stop.addEventListener("click", gestureStopRecording);
if (gestureElements.save) gestureElements.save.addEventListener("click", gestureSaveReference);
if (gestureElements.compare) gestureElements.compare.addEventListener("click", gestureCompare);
if (gestureElements.clear) gestureElements.clear.addEventListener("click", gestureClearCurrent);
gestureReference = gestureLoadReference();
gestureRenderHistory();
gestureDrawCharts([]);
gestureUpdateUI();
// Keep recorder controls in sync with sensor connection lifecycle.
const gestureOriginalSetTransportStatus = setTransportStatus;
setTransportStatus = function(text) {
  gestureOriginalSetTransportStatus(text);
  if (typeof gestureUpdateUI === "function") gestureUpdateUI();
};
window.addEventListener("resize", () => {
  gestureDrawCharts(gestureRecording ? gestureCurrentBuffer : (gestureCompletedRecording || []));
});
// ========================================================
// END GESTURE RECORDER / COMPARATOR
// ========================================================
// USER MODE is the default transport on every page load.
selectBLETransport();
// ========================================================
// V53 — CONTACT RECORDER V2: SESSION + MANUAL EVENT LABELS
// ========================================================
// Stage 8.2: human-provided ground truth; NOT a contact detector.
// Every trial is a separate 400-sample FIFO capture followed by BLE transfer.
// These trials do not form one gapless 100 Hz session. All completed trials
// stay in browser RAM and can be exported as an offline, uncompressed ZIP.
// Firmware V28.1 uses the unchanged 'C', 'N<index>', 'F', 'X' protocol.
const contactUI = {
    label: document.getElementById("contactLabel"),
    start: document.getElementById("contactStartButton"),
    cancel: document.getElementById("contactCancelButton"),
    download: document.getElementById("contactDownloadButton"),
    status: document.getElementById("contactStatus"),
    samples: document.getElementById("contactSamples"),
    integrity: document.getElementById("contactIntegrity"),
    phase: document.getElementById("contactPhase"),
    sessionStart: document.getElementById("contactSessionStartButton"),
    sessionEnd: document.getElementById("contactSessionEndButton"),
    sessionExport: document.getElementById("contactExportButton"),
    sessionBadge: document.getElementById("contactSessionBadge"),
    trialCount: document.getElementById("contactSessionTrials"),
    sampleCount: document.getElementById("contactSessionSamples"),
    confirmedCount: document.getElementById("contactSessionConfirmed"),
    trialSelect: document.getElementById("contactTrialSelect"),
    accChart: document.getElementById("contactAccChart"),
    gyroChart: document.getElementById("contactGyroChart"),
    cursorInfo: document.getElementById("contactCursorInfo"),
    markTrue: document.getElementById("contactMarkTrue"),
    markNegative: document.getElementById("contactMarkNegative"),
    markUncertain: document.getElementById("contactMarkUncertain"),
    markers: document.getElementById("contactMarkers"),
    report: document.getElementById("contactReport")
};
const contactCapture = {
    state: "idle", data: [], total: 400, firstSeq: null,
    firstTimeUs: null, expected: 0, retries: 0,
    packetTimer: null, phaseTimer: null, attemptId: 0,
    retryTotal: 0, lastLabel: "ball", capturedAt: null,
    invalidPacketCount: 0
};
const contactSession = {
    active: false, startedAt: null, endedAt: null,
    id: null, trials: [], failures: [], selectedTrialId: null,
    cursorIndex: null
};
const CONTACT_TYPES = {ball: "Uderzenia piłki", air: "Zamach bez kontaktu", hand: "Stuknięcie dłonią", other: "Inne / zakłócenie"};
const CONTACT_LABELS = {ball: "Kontakt piłki", not_ball: "Nie kontakt piłki", uncertain: "Niepewne"};
const CONTACT_MAX_TRIALS = 100;

function contactSetStatus(message) {
    if (contactUI.status) contactUI.status.textContent = message;
}
function contactIsBusy() {
    return ["starting", "recording", "downloading", "finalizing"].includes(contactCapture.state);
}
function contactSelectedTrial() {
    return contactSession.trials.find(t => t.id === contactSession.selectedTrialId) || null;
}
function contactStats() {
    const trials = contactSession.trials;
    const markers = trials.flatMap(t => t.markers);
    return {
        trials: trials.length,
        samples: trials.reduce((n,t) => n + t.samples.length,0),
        ball: markers.filter(m => m.label === "ball").length,
        notBall: markers.filter(m => m.label === "not_ball").length,
        uncertain: markers.filter(m => m.label === "uncertain").length,
        retries: trials.reduce((n,t) => n + t.retries,0),
        errors: contactSession.failures.length
    };
}
function contactRefresh() {
    const busy = contactIsBusy();
    const active = contactSession.active;
    const trial = contactSelectedTrial();
    const st = contactStats();
    if (contactUI.start) contactUI.start.disabled = !active || !bleTransport || measuring || busy || st.trials >= CONTACT_MAX_TRIALS;
    if (contactUI.cancel) contactUI.cancel.disabled = !busy || contactCapture.state === "finalizing";
    if (contactUI.download) contactUI.download.disabled = !trial;
    if (contactUI.label) contactUI.label.disabled = !active || busy;
    if (contactUI.sessionStart) contactUI.sessionStart.disabled = active || busy;
    if (contactUI.sessionEnd) contactUI.sessionEnd.disabled = !active || busy;
    if (contactUI.sessionExport) contactUI.sessionExport.disabled = st.trials === 0 || busy;
    if (contactUI.samples) contactUI.samples.textContent = `${contactCapture.data.length} / ${contactCapture.total}`;
    if (contactUI.phase) contactUI.phase.textContent = contactCapture.state.toUpperCase();
    if (contactUI.integrity) contactUI.integrity.textContent = contactCapture.state === "done" ? "PASS" : contactCapture.state === "failed" ? "FAIL" : "—";
    if (contactUI.trialCount) contactUI.trialCount.textContent = `${st.trials} / ${st.trials}`;
    if (contactUI.sampleCount) contactUI.sampleCount.textContent = String(st.samples);
    if (contactUI.confirmedCount) contactUI.confirmedCount.textContent = String(st.ball);
    if (contactUI.sessionBadge) contactUI.sessionBadge.textContent = active ? "Sesja aktywna" : contactSession.startedAt ? "Sesja zakończona" : "Brak sesji";
    if (contactUI.trialSelect) contactUI.trialSelect.disabled = st.trials === 0 || busy;
    const canMark = !!trial && contactSession.cursorIndex !== null && !busy;
    for (const button of [contactUI.markTrue, contactUI.markNegative, contactUI.markUncertain]) {
        if (button) button.disabled = !canMark;
    }
    contactRenderReport();
}
function contactCRC16(bytes) {
    let crc = 0xFFFF;
    for (const b of bytes) {
        crc ^= (b << 8);
        for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
    }
    return crc;
}
function contactClearTimers() {
    if (contactCapture.packetTimer) clearTimeout(contactCapture.packetTimer);
    if (contactCapture.phaseTimer) clearTimeout(contactCapture.phaseTimer);
    contactCapture.packetTimer = null;
    contactCapture.phaseTimer = null;
}
function contactPhaseTimeout(milliseconds, message, validStates) {
    const generation = contactCapture.attemptId;
    if (contactCapture.phaseTimer) clearTimeout(contactCapture.phaseTimer);
    contactCapture.phaseTimer = setTimeout(() => {
        if (contactCapture.attemptId === generation && validStates.includes(contactCapture.state)) contactFail(message);
    }, milliseconds);
}
function contactFail(message) {
    const oldState = contactCapture.state;
    if (!contactIsBusy()) return;
    const validConnection = !!bleTransport;
    contactClearTimers();
    contactCapture.attemptId++;
    contactCapture.state = "failed";
    contactSession.failures.push({at:new Date().toISOString(),phase:oldState,error:message});
    contactSetStatus("Nieudana próba: " + message + ". Poprzednie udane próby pozostają w sesji.");
    contactRefresh();
    if (validConnection) bleTransport.send("X").catch(() => {});
}
function contactStartSession() {
    if (contactSession.active || contactIsBusy()) return;
    if (contactSession.startedAt && (contactSession.trials.length || contactSession.failures.length)) {
        if (!window.confirm("Nowa sesja usunie dotychczasowe dane z pamięci strony. Czy masz już wyeksportowany ZIP?")) return;
    }
    contactSession.active = true;
    contactSession.startedAt = new Date().toISOString();
    contactSession.endedAt = null;
    contactSession.id = "GZ-" + Date.now().toString(36).toUpperCase();
    contactSession.trials = [];
    contactSession.failures = [];
    contactSession.selectedTrialId = null;
    contactSession.cursorIndex = null;
    contactCapture.state = "idle";
    contactCapture.data = [];
    contactSetStatus("Sesja rozpoczęta. Wybierz rodzaj próby, nagraj 4 sekundy i oznacz kontakty na wykresach.");
    contactRenderTrialSelect();
    contactRenderTrial();
    contactRefresh();
}
function contactEndSession() {
    if (!contactSession.active || contactIsBusy()) return;
    contactSession.active = false;
    contactSession.endedAt = new Date().toISOString();
    contactSetStatus("Sesja zakończona. Sprawdź oznaczenia i pobierz ZIP z próbkami, etykietami oraz raportem.");
    contactRefresh();
}
async function contactStart() {
    if (!contactSession.active || !bleTransport || measuring || contactIsBusy()) return;
    contactClearTimers();
    Object.assign(contactCapture, {
        state:"starting",data:[],total:400,firstSeq:null,firstTimeUs:null,
        expected:0,retries:0,retryTotal:0,invalidPacketCount:0,
        lastLabel:contactUI.label?.value || "ball",capturedAt:new Date().toISOString()
    });
    contactCapture.attemptId++;
    contactSetStatus("Oczekiwanie na uruchomienie czterosekundowego zapisu w Arduino…");
    contactRefresh();
    contactPhaseTimeout(10000,"brak potwierdzenia CAP,STARTED przez BLE",["starting"]);
    try { await bleTransport.send("C"); }
    catch(e) { contactFail(e.message); }
}
async function contactCancel() {
    if (!contactIsBusy()) return;
    contactCapture.attemptId++;
    contactClearTimers();
    contactCapture.state = "idle";
    contactCapture.data = [];
    contactSetStatus("Próba anulowana. Dotychczasowe ukończone próby są zachowane.");
    contactRefresh();
    if (bleTransport) try { await bleTransport.send("X"); } catch(e) { console.warn("CAP cancel",e); }
}
function contactDisconnected() {
    if (contactIsBusy()) {
        // disconnectSensor() may still hold the stale transport object.
        contactFail("przerwano połączenie BLE");
    }
    contactRefresh();
}
function contactReceiveStatus(line) {
    lastHeartbeatTime = Date.now();
    const fields = line.split(",");
    const type = fields[1];
    if (type === "STARTED" && contactCapture.state === "starting") {
        contactCapture.state = "recording";
        contactSetStatus("Rejestracja trwa — wykonaj teraz uderzenie lub próbę kontrolną przez 4 sekundy.");
        contactRefresh();
        contactPhaseTimeout(11000,"brak CAP,READY po nagrywaniu",["recording"]);
        return;
    }
    if (type === "PROGRESS" && contactCapture.state === "recording") {
        contactSetStatus("Rejestrowanie w pamięci Arduino: " + fields[2] + " / 400 próbek…");
        return;
    }
    if (type === "READY" && contactCapture.state === "recording") {
        const total = Number(fields[2]);
        const seq = Number(fields[3]);
        const time = Number(fields[4]);
        if (total !== 400 || !Number.isSafeInteger(seq) || seq < 1 || !Number.isSafeInteger(time) || time < 0) {
            contactFail("nieprawidłowe metadane CAP,READY"); return;
        }
        if (contactCapture.phaseTimer) clearTimeout(contactCapture.phaseTimer);
        contactCapture.phaseTimer = null;
        Object.assign(contactCapture,{total,firstSeq:seq,firstTimeUs:time,state:"downloading",expected:0,retries:0});
        contactSetStatus("Zebrano 400 próbek w Arduino. Teraz pobieranie i kontrola CRC przez BLE…");
        contactRefresh();
        contactRequest(0);
        return;
    }
    if (type === "DONE" && contactCapture.state === "finalizing") {
        contactClearTimers();
        contactCapture.state = "done";
        contactSetStatus("Próba zakończona i zamknięta: 400/400 PASS. Kliknij wykres w miejscu kontaktu i nadaj etykietę. Możesz nagrać kolejną próbę.");
        contactRefresh();
        return;
    }
    if (type === "ERROR" && contactIsBusy()) {
        contactFail(fields.slice(2).join(",") || "błąd zgłoszony przez Arduino");
    }
}
async function contactRequest(index) {
    if (contactCapture.state !== "downloading" || index !== contactCapture.expected || !bleTransport) return;
    if (contactCapture.packetTimer) clearTimeout(contactCapture.packetTimer);
    const generation = contactCapture.attemptId;
    contactCapture.packetTimer = setTimeout(() => {
        if (contactCapture.state !== "downloading" || generation !== contactCapture.attemptId || index !== contactCapture.expected) return;
        contactCapture.retries++;
        contactCapture.retryTotal++;
        if (contactCapture.retries > 6) {
            contactFail("brak pakietu #" + index + " po 6 ponowieniach");
            return;
        }
        contactRequest(index);
    },2500);
    try { await bleTransport.send("N" + index); }
    catch(e) {
        if (generation === contactCapture.attemptId && contactCapture.state === "downloading") contactFail(e.message);
    }
}
function contactReceiveDataPacket(event) {
    if (contactCapture.state !== "downloading") return;
    lastHeartbeatTime = Date.now();
    const view = event?.target?.value;
    if (!view || view.byteLength !== 20) { contactCapture.invalidPacketCount++; return; }
    const bytes = new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
    if (contactCRC16(bytes.subarray(0,18)) !== view.getUint16(18,true)) { contactCapture.invalidPacketCount++; return; }
    const index = view.getUint16(0,true);
    const sequence = view.getUint32(2,true);
    if (index !== contactCapture.expected) return; // delayed response to a previous request
    if (sequence !== ((contactCapture.firstSeq + index) >>> 0)) { contactFail("przerwana sekwencja próbki " + index); return; }
    if (contactCapture.packetTimer) clearTimeout(contactCapture.packetTimer);
    contactCapture.packetTimer = null;
    contactCapture.data.push({
        index, sequence, time_ms:index*10,
        sensor_time_us_nominal: ((contactCapture.firstTimeUs + index*10000) >>> 0),
        AX:view.getInt16(6,true)/1000, AY:view.getInt16(8,true)/1000, AZ:view.getInt16(10,true)/1000,
        GX:view.getInt16(12,true)/10, GY:view.getInt16(14,true)/10, GZ:view.getInt16(16,true)/10
    });
    contactCapture.expected++;
    contactCapture.retries = 0;
    if (index%20 === 0 || contactCapture.expected === contactCapture.total) contactRefresh();
    if (contactCapture.expected === contactCapture.total) {
        contactFinishTrial();
        return;
    }
    // Continue only when current packet has passed CRC16 and sequence verification.
    Promise.resolve().then(() => contactRequest(contactCapture.expected));
}
function contactFinishTrial() {
    contactClearTimers();
    const samples = contactCapture.data.map(s=>({...s}));
    const firstSeq = contactCapture.firstSeq;
    const lastSeq = samples.at(-1)?.sequence;
    if (samples.length !== 400 || lastSeq !== ((firstSeq+399)>>>0)) {
        contactFail("niekompletny zapis 400 próbek");return;
    }
    const trial = {
        id:contactSession.trials.length+1, type:contactCapture.lastLabel,
        capturedAt:contactCapture.capturedAt, completedAt:new Date().toISOString(),
        firstSeq, lastSeq, firstTimeUs:contactCapture.firstTimeUs,
        samplePeriodUs:10000, count:samples.length, integrity:"PASS",
        retries:contactCapture.retryTotal, invalidPackets:contactCapture.invalidPacketCount,
        samples, markers:[]
    };
    contactSession.trials.push(trial);
    contactSession.selectedTrialId = trial.id;
    contactSession.cursorIndex = null;
    contactCapture.state = "finalizing";
    contactSetStatus("Próba #"+trial.id+" zapisana: 400/400, CRC16 i sekwencje PASS. Potwierdzanie finalizacji BLE…");
    contactRenderTrialSelect();
    contactRenderTrial();
    contactRefresh();
    contactPhaseTimeout(9000,"brak potwierdzenia CAP,DONE po zapisaniu danych",["finalizing"]);
    if (bleTransport) bleTransport.send("F").catch(e=>contactFail("finalizacja BLE: "+e.message));
}
function contactRenderTrialSelect() {
    if (!contactUI.trialSelect) return;
    const el=contactUI.trialSelect;
    el.replaceChildren();
    if (!contactSession.trials.length) {
        const option=document.createElement("option"); option.value=""; option.textContent="Brak prób";el.appendChild(option);
        return;
    }
    for (const t of contactSession.trials) {
        const option=document.createElement("option");
        option.value=String(t.id);option.textContent="#"+t.id+" — "+(CONTACT_TYPES[t.type]||t.type)+" (400 próbek)";
        el.appendChild(option);
    }
    el.value=String(contactSession.selectedTrialId);
}
function contactCanvasPlot(canvas, samples, channels) {
    if (!canvas) return;
    const rect=canvas.getBoundingClientRect();
    const width=Math.max(260,Math.floor(rect.width || 620));
    const height=210;
    const pixelRatio=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(width*pixelRatio);
    canvas.height=Math.round(height*pixelRatio);
    const ctx=canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    ctx.clearRect(0,0,width,height);
    const left=43,right=width-12,top=19,bottom=height-28;
    ctx.lineWidth=1;
    ctx.strokeStyle="#e2e8f0";
    for(let i=0;i<=4;i++) {
        const y=top+(bottom-top)*i/4;
        ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
    }
    ctx.fillStyle="#64748b";ctx.font="11px Arial";
    if (!samples || samples.length<2) {
        ctx.fillText("Brak pobranych próbek",left+12,height/2);return;
    }
    const values=channels.flatMap(ch=>samples.map(s=>s[ch]));
    let min=Math.min(...values),max=Math.max(...values);
    const extra=Math.max(0.01,(max-min)*0.08);
    min-=extra;max+=extra;
    const span=Math.max(0.01,max-min);
    ctx.fillText(max.toFixed(1),3,top+4);
    ctx.fillText(min.toFixed(1),3,bottom);
    const colors=["#2563eb","#16a34a","#dc2626"];
    for(let k=0;k<channels.length;k++) {
        ctx.strokeStyle=colors[k];ctx.lineWidth=1.3;ctx.beginPath();
        for(let i=0;i<samples.length;i++) {
            const x=left+(right-left)*i/(samples.length-1);
            const y=bottom-(samples[i][channels[k]]-min)/span*(bottom-top);
            if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.stroke();
        ctx.fillStyle=colors[k];ctx.fillText(channels[k],left+k*49,bottom+18);
    }
    const trial=contactSelectedTrial();
    if (trial) {
        for(const m of trial.markers) {
            const x=left+(right-left)*m.index/(samples.length-1);
            ctx.strokeStyle=m.label==="ball"?"#059669":m.label==="not_ball"?"#e11d48":"#d97706";
            ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
        }
    }
    if(contactSession.cursorIndex!==null) {
        const x=left+(right-left)*contactSession.cursorIndex/(samples.length-1);
        ctx.strokeStyle="#111827";ctx.lineWidth=1;ctx.setLineDash([4,3]);
        ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.fillStyle="#64748b";ctx.fillText("0 s",left,bottom+30);
    ctx.fillText("3.99 s",right-40,bottom+30);
}
function contactRenderTrial() {
    const trial=contactSelectedTrial();
    contactCanvasPlot(contactUI.accChart, trial?.samples || [],["AX","AY","AZ"]);
    contactCanvasPlot(contactUI.gyroChart, trial?.samples || [],["GX","GY","GZ"]);
    if (contactUI.cursorInfo) {
        if (!trial) contactUI.cursorInfo.textContent="Zarejestruj próbę, a następnie kliknij wykres.";
        else if (contactSession.cursorIndex === null) contactUI.cursorInfo.textContent="Próba #"+trial.id+": kliknij wykres przy sygnale kontaktu, aby wybrać dokładną próbkę.";
        else {
            const s=trial.samples[contactSession.cursorIndex];
            contactUI.cursorInfo.textContent=`Próba #${trial.id}: próbka ${s.index}, SEQ=${s.sequence}, t=${s.time_ms} ms (nominalnie), G=${Math.hypot(s.AX,s.AY,s.AZ).toFixed(3)} g`;
        }
    }
    contactRenderMarkers();
}
function contactChooseSample(event) {
    const trial=contactSelectedTrial();if (!trial || contactIsBusy()) return;
    const canvas=event.currentTarget;
    const rect=canvas.getBoundingClientRect();
    const width=Math.max(260,Math.floor(rect.width||620));
    const left=43,right=width-12;
    const px=event.clientX-rect.left;
    const index=Math.round(Math.max(0,Math.min(1,(px-left)/(right-left)))*399);
    contactSession.cursorIndex=index;
    contactRenderTrial();contactRefresh();
}
function contactAddMarker(label) {
    const trial=contactSelectedTrial();
    const index=contactSession.cursorIndex;
    if(!trial || index===null || contactIsBusy()) return;
    let marker=trial.markers.find(m=>m.index===index);
    if(marker) { marker.label=label;marker.updatedAt=new Date().toISOString(); }
    else trial.markers.push({index,sequence:trial.samples[index].sequence,time_ms:index*10,label,updatedAt:new Date().toISOString(),source:"human"});
    trial.markers.sort((a,b)=>a.index-b.index);
    contactRenderTrial();contactRefresh();
}
function contactRemoveMarker(index) {
    const trial=contactSelectedTrial();if (!trial || contactIsBusy()) return;
    trial.markers=trial.markers.filter(m=>m.index!==index);
    contactRenderTrial();contactRefresh();
}
function contactRenderMarkers() {
    if (!contactUI.markers) return;
    const el=contactUI.markers;
    el.replaceChildren();
    const trial=contactSelectedTrial();
    if (!trial || !trial.markers.length) {
        el.textContent=trial && trial.type!=="ball" ? "Brak znaczników. Dla prób bez piłki jest to prawidłowe, o ile nie wystąpiło żadne zdarzenie do zaznaczenia." : "Brak oznaczeń. Kliknij na wykresie, aby wskazać rzeczywisty kontakt.";
        return;
    }
    for (const marker of trial.markers) {
        const row=document.createElement("div");row.className="contact-marker-row";
        const label=document.createElement("span");
        label.textContent=`#${trial.id} · ${marker.time_ms} ms · SEQ ${marker.sequence} · ${CONTACT_LABELS[marker.label]}`;
        const remove=document.createElement("button");remove.className="secondary";
        remove.type="button";remove.textContent="Usuń";
        remove.disabled=contactIsBusy();
        remove.addEventListener("click",()=>contactRemoveMarker(marker.index));
        row.append(label,remove);el.appendChild(row);
    }
}
function contactRenderReport() {
    if(!contactUI.report)return;
    const el=contactUI.report;
    el.replaceChildren();
    const st=contactStats();
    if(!contactSession.startedAt) {el.textContent="Rozpocznij sesję, aby zbierać próby i tworzyć raport.";return;}
    const grid=document.createElement("div");grid.className="contact-report-grid";
    const metrics=[
        ["Prób ukończonych",st.trials],["Próbek zweryfikowanych",st.samples],
        ["Kontakty oznaczone",st.ball],["Nie kontakt piłki",st.notBall],
        ["Niepewne znaczniki",st.uncertain],["Ponowienia pakietów BLE",st.retries],
        ["Nieudane próby",st.errors]
    ];
    for(const [name,val] of metrics) {
        const card=document.createElement("div");card.className="contact-report-metric";
        const small=document.createElement("span");small.textContent=name;
        const strong=document.createElement("strong");strong.textContent=String(val);
        card.append(small,strong);grid.appendChild(card);
    }
    el.appendChild(grid);
    const p=document.createElement("p");
    p.textContent="Kompletność: "+(st.trials?"400/400 próbek w każdej ukończonej próbie (CRC16 + SEQ PASS)":"brak prób")+". Dane obejmują tylko zapisane okna 4 s. Precyzja i czułość detektora nie są obliczane: firmware V28.1 nie wykrywa jeszcze kontaktów. Oznaczenia są ręczne.";
    el.appendChild(p);
}
function contactCSVCell(value) {
    const s=String(value??"");
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function contactCSV(rows) {return rows.map(r=>r.map(contactCSVCell).join(",")).join("\r\n")+"\r\n";}
function contactTrialCSV(trial) {
    const marks=new Map(trial.markers.map(m=>[m.index,m.label]));
    const rows=[["session_id","trial_id","trial_type","index","sequence","sensor_time_us_nominal","time_ms","AX_g","AY_g","AZ_g","G_g","GX_dps","GY_dps","GZ_dps","gyro_magnitude_dps","reference_label"]];
    for(const s of trial.samples) rows.push([
        contactSession.id,trial.id,trial.type,s.index,s.sequence,s.sensor_time_us_nominal,s.time_ms,
        s.AX,s.AY,s.AZ,Math.hypot(s.AX,s.AY,s.AZ).toFixed(5),
        s.GX,s.GY,s.GZ,Math.hypot(s.GX,s.GY,s.GZ).toFixed(3),marks.get(s.index)||""
    ]);
    return contactCSV(rows);
}
function contactSaveBlob(filename,blob) {
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function contactDownload() {
    const t=contactSelectedTrial();if(!t)return;
    const csv=contactTrialCSV(t);
    contactSaveBlob("gazela_trial_"+String(t.id).padStart(3,"0")+"_"+t.type+".csv",new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));
}
function contactCRC32(bytes) {
    let crc=0xFFFFFFFF;
    for(const byte of bytes) {
        crc^=byte;
        for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);
    }
    return (crc^0xFFFFFFFF)>>>0;
}
function contactU16(n) {return [n&255,(n>>>8)&255];}
function contactU32(n) {return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}
// Small standards-compatible STORE ZIP writer, no CDN or third-party packages.
// Each file is stored uncompressed, with UTF-8 filename flag and CRC32.
function contactBuildZip(files) {
    const encoder=new TextEncoder();
    const parts=[],central=[];
    let offset=0;
    for(const [filename,content] of files) {
        const name=encoder.encode(filename);
        const bytes=encoder.encode(content);
        if(name.length>65535 || bytes.length>0xFFFFFFFF)throw new Error("Plik jest zbyt duży dla prostego formatu ZIP");
        const crc=contactCRC32(bytes);
        const flags=0x0800;
        const local=new Uint8Array([
            ...contactU32(0x04034b50),...contactU16(20),...contactU16(flags),...contactU16(0),...contactU16(0),...contactU16(0),
            ...contactU32(crc),...contactU32(bytes.length),...contactU32(bytes.length),...contactU16(name.length),...contactU16(0)
        ]);
        parts.push(local,name,bytes);
        const header=new Uint8Array([
            ...contactU32(0x02014b50),...contactU16(20),...contactU16(20),...contactU16(flags),...contactU16(0),
            ...contactU16(0),...contactU16(0),...contactU32(crc),...contactU32(bytes.length),...contactU32(bytes.length),
            ...contactU16(name.length),...contactU16(0),...contactU16(0),...contactU16(0),...contactU16(0),
            ...contactU32(0),...contactU32(offset)
        ]);
        central.push(header,name);
        offset+=local.length+name.length+bytes.length;
    }
    const centralStart=offset;
    const centralSize=central.reduce((n,part)=>n+part.length,0);
    if(centralStart+centralSize>0xFFFFFFFF)throw new Error("Archiwum przekracza limit ZIP32");
    const end=new Uint8Array([
        ...contactU32(0x06054b50),...contactU16(0),...contactU16(0),
        ...contactU16(files.length),...contactU16(files.length),
        ...contactU32(centralSize),...contactU32(centralStart),...contactU16(0)
    ]);
    return new Blob([...parts,...central,end],{type:"application/zip"});
}
function contactExport() {
    if(contactIsBusy() || !contactSession.trials.length)return;
    const stats=contactStats();
    const meta={
        schema:"gazela.contact.session.v2",sessionId:contactSession.id,
        startedAt:contactSession.startedAt,endedAt:contactSession.endedAt,
        exportedAt:new Date().toISOString(),
        firmware:"V28.1 (expected; not remotely attested)",frontend:"V53",
        sensor:"BMI270 ACC+GYRO",sampleRateNominalHz:100,samplePeriodUsNominal:10000,
        captureMode:"independent 400-sample trials; gaps between trials are NOT recorded",
        quantization:{acc_g:0.001,gyro_dps:0.1},
        detector:{implemented:false,precision:null,recall:null,falsePositives:null,falseNegatives:null},
        labels:{authority:"user_manual",timing:"selected on waveform, nominal 10ms grid"},
        stats,trials:contactSession.trials.map(t=>({id:t.id,type:t.type,capturedAt:t.capturedAt,
            completedAt:t.completedAt,firstSeq:t.firstSeq,lastSeq:t.lastSeq,
            firstTimeUs:t.firstTimeUs,count:t.samples.length,integrity:t.integrity,
            retries:t.retries,invalidPackets:t.invalidPackets,markers:t.markers})),
        failures:contactSession.failures
    };
    const rows=[["session_id","trial_id","trial_type","index","sequence","time_ms","label","source","updated_at"]];
    for(const t of contactSession.trials)for(const m of t.markers) rows.push([
        contactSession.id,t.id,t.type,m.index,m.sequence,m.time_ms,m.label,m.source,m.updatedAt
    ]);
    const report=[
        "GAZELA SPINER SENSOR — CONTACT RECORDER V2",`Session: ${contactSession.id}`,
        `Started: ${contactSession.startedAt}`,`Ended: ${contactSession.endedAt||"still active"}`,
        `Trials completed: ${stats.trials}`,`CRC/SEQ-verified samples: ${stats.samples}`,
        `Manually labeled ball contacts: ${stats.ball}`,`Manually marked non-ball: ${stats.notBall}`,
        `Uncertain labels: ${stats.uncertain}`,`BLE packet retries: ${stats.retries}`,
        `Failed trials: ${stats.errors}`,
        "No automatic contact detector in firmware V28.1. Precision/recall cannot be calculated.",
        "Gaps between 4-second trials are NOT recorded. No BLE packet timing is used as sensor time.",
        "Sensor timestamps are reconstructed at nominal 100 Hz and not hardware BMI270 timestamps."
    ].join("\n")+"\n";
    const files=[
        ["README.txt","GAZELA CONTACT RECORDER V2\nFiles: each trial_XXX.csv has all 400 samples; labels.csv has manual event labels; session.json and report.txt summarize the dataset.\nNo automatic impact detector in firmware. Four-second trials are discontinuous.\n"],
        ["report.txt",report],
        ["session.json",JSON.stringify(meta,null,2)+"\n"],
        ["labels.csv",contactCSV(rows)]
    ];
    for(const t of contactSession.trials) files.push([
        "trial_"+String(t.id).padStart(3,"0")+"_"+t.type+".csv",contactTrialCSV(t)
    ]);
    try {
        const blob=contactBuildZip(files);
        contactSaveBlob("GAZELA_CONTACT_"+contactSession.id+".zip",blob);
        contactSetStatus("Zapisano archiwum ZIP: "+stats.trials+" prób, "+stats.samples+" próbek, "+stats.ball+" ręcznie oznaczonych kontaktów.");
    }catch(e) {
        contactSetStatus("Błąd eksportu ZIP: "+e.message);
        console.error(e);
    }
}
if(contactUI.sessionStart)contactUI.sessionStart.addEventListener("click",contactStartSession);
if(contactUI.sessionEnd)contactUI.sessionEnd.addEventListener("click",contactEndSession);
if(contactUI.sessionExport)contactUI.sessionExport.addEventListener("click",contactExport);
if(contactUI.start)contactUI.start.addEventListener("click",contactStart);
if(contactUI.cancel)contactUI.cancel.addEventListener("click",contactCancel);
if(contactUI.download)contactUI.download.addEventListener("click",contactDownload);
if(contactUI.trialSelect)contactUI.trialSelect.addEventListener("change",value=>{
    const id=Number(value.target.value);
    if(contactSession.trials.some(t=>t.id===id)) {
        contactSession.selectedTrialId=id;contactSession.cursorIndex=null;
        contactRenderTrial();contactRefresh();
    }
});
if(contactUI.accChart)contactUI.accChart.addEventListener("click",contactChooseSample);
if(contactUI.gyroChart)contactUI.gyroChart.addEventListener("click",contactChooseSample);
if(contactUI.markTrue)contactUI.markTrue.addEventListener("click",()=>contactAddMarker("ball"));
if(contactUI.markNegative)contactUI.markNegative.addEventListener("click",()=>contactAddMarker("not_ball"));
if(contactUI.markUncertain)contactUI.markUncertain.addEventListener("click",()=>contactAddMarker("uncertain"));
window.addEventListener("resize",()=>contactRenderTrial());
contactRenderTrial();
contactRefresh();
