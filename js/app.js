// app.js — GAZELA SENSOR V61 / STAGE 8.9 LOCAL REFERENCE LIBRARY HR400 + V57 REPLAY / V28.1 HR400
// V61: local capture/transfer indicators for Learning and Comparator; same BLE engine.
// V60: persistent, explicitly saved reference snapshots in IndexedDB; research sessions remain in RAM.
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
            // HR400 FIFO runs at nominal 400 Hz, while LIVE is ~50 Hz.
            // ~8 FIFO samples between LIVE frames is nominal, not a gap.
            // This excess-jump counter is only a scheduling heuristic:
            // BLE jitter and skipped LIVE updates do NOT prove FIFO loss.
            const nominalFifoPerLive = 8;
            if (delta > nominalFifoPerLive && delta < 0x80000000) {
                fifoSequenceGapCount += delta - nominalFifoPerLive;
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
    // V55: read-only graphical preview, no change to FIFO/BLE protocol.
    liveWaveReceiveSample({AX, AY, AZ, GX, GY, GZ});
 
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
    if (contactIsBusy()) { addSerialLine("Measurement blocked: HR400 capture in progress.","serial-info"); return; }
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
// USER MODE is the default transport on every page load.
selectBLETransport();
// ========================================================
// V53 — CONTACT RECORDER V2: SESSION + MANUAL EVENT LABELS
// ========================================================
// Stage 8.4: 1600-sample FIFO capture at nominal 400 Hz (~4 seconds),
// manual ground truth and ACK-gated commit. NOT a ball contact detector.
// Trials are separate; gaps between trials are not recorded.
// Firmware V28.1 protocol remains 'C', 'N<index>', 'F', 'X'.

// ========================================================
// STAGE 8.6 — BALL CONTACT DETECTOR OFFLINE V1 (EXPERIMENTAL)
// Only after CRC16/SEQ PASS and CAP,DONE. Ground truth remains human-only.
// ΔACC 3D + opposite impulse C (<= 40 ms) + E20 vector cancellation.
// Thresholds are provisional, based on earlier exploratory recordings;
// do NOT interpret these as independently validated sensitivity/specificity.
// ========================================================
const GAZELA_OFFLINE_DETECTOR_VERSION = "OFFLINE_V1_400HZ_2026_11";
const GAZELA_DETECTOR_CONFIG = Object.freeze({
    triggerDeltaG: 0.35, minOppositeG: 0.25,
    minE20G: 0.90, oppositionSamples: 16,
    eWindowSamples: 8, mergeSamples: 32, onsetThresholdG: 0.25,
    onsetBackSamples: 24
});
function gazelaDetectContactOffline(samples, cfg = GAZELA_DETECTOR_CONFIG) {
    if (!Array.isArray(samples) || samples.length < 24) return {version:GAZELA_OFFLINE_DETECTOR_VERSION, candidates:[], strongest:null};
    const n=samples.length;
    const diffs=new Array(n); const mags=new Float64Array(n);
    diffs[0]=[0,0,0];
    for(let i=1;i<n;i++) {
        const a=samples[i], b=samples[i-1];
        const d=[a.AX-b.AX,a.AY-b.AY,a.AZ-b.AZ];
        if(!d.every(Number.isFinite)) return {version:GAZELA_OFFLINE_DETECTOR_VERSION,candidates:[],strongest:null,error:"non-finite ACC"};
        diffs[i]=d; mags[i]=Math.hypot(...d);
    }
    // E20 ending at k: sum(|ΔA|) - |sum(ΔA)| over 8 changes (20 ms).
    const e20=new Float64Array(n);
    for(let k=cfg.eWindowSamples;k<n;k++) {
        let L=0,x=0,y=0,z=0;
        for(let j=k-cfg.eWindowSamples+1;j<=k;j++) {
            L+=mags[j]; x+=diffs[j][0];y+=diffs[j][1];z+=diffs[j][2];
        }
        e20[k]=Math.max(0,L-Math.hypot(x,y,z));
    }
    const raw=[];
    for(let i=1;i<n-1;i++) {
        if(mags[i]<cfg.triggerDeltaG) continue;
        const u=diffs[i].map(v=>v/mags[i]);
        let opposite=0, oppositeIndex=-1;
        const finish=Math.min(n-1,i+cfg.oppositionSamples);
        for(let j=i+1;j<=finish;j++) {
            const projection=-(diffs[j][0]*u[0]+diffs[j][1]*u[1]+diffs[j][2]*u[2]);
            if(projection>opposite){opposite=projection;oppositeIndex=j;}
        }
        const c=Math.min(mags[i],opposite);
        if(c<cfg.minOppositeG)continue;
        // E20 may peak after the candidate; allow a 40ms follow-up.
        let emax=0,eIndex=i;
        for(let j=i;j<=finish;j++)if(e20[j]>emax){emax=e20[j];eIndex=j;}
        if(emax<cfg.minE20G)continue;
        let onset=i;
        // Return to the first uninterrupted supra-threshold edge. This is
        // an estimated signal onset, NOT physical ball/string contact time.
        for(let j=i-1;j>=Math.max(1,i-cfg.onsetBackSamples);j--) {
            if(mags[j]>=cfg.onsetThresholdG)onset=j;
            else break;
        }
        const gyro=Math.hypot(samples[i].GX,samples[i].GY,samples[i].GZ);
        const score=Math.min(100,Math.round(25*Math.log1p(mags[i])+25*Math.log1p(c)+20*Math.log1p(emax)));
        raw.push({index:onset,peakIndex:i,oppositeIndex,eIndex,
          sequence:samples[onset].sequence,timeMs:samples[onset].time_ms,
          deltaAccG:mags[i],oppositeG:c,e20G:emax,
          oppositeDelayMs:(oppositeIndex-i)*2.5,gyroDps:gyro,score});
    }
    // Merge multiple oscillatory impulses from a single strike (80 ms).
    // This deduplication is only an initial policy, not a guarantee of one
    // candidate per physical strike.
    raw.sort((a,b)=>a.peakIndex-b.peakIndex);
    const clusters=[];
    for(const event of raw){
        const last=clusters.at(-1);
        if(last && event.peakIndex-last.lastPeak<=cfg.mergeSamples){
            last.lastPeak=event.peakIndex;
            if(event.score>last.best.score || (event.score===last.best.score&&event.e20G>last.best.e20G))last.best=event;
        } else clusters.push({lastPeak:event.peakIndex,best:event});
    }
    const candidates=clusters.map(x=>x.best).sort((a,b)=>a.index-b.index);
    const strongest=candidates.length?candidates.reduce((a,b)=>b.score>a.score?b:a):null;
    return {version:GAZELA_OFFLINE_DETECTOR_VERSION,configuration:{...cfg},candidates,strongest};
}
function gazelaDetectorTruthAssessment(trial) {
    const count=trial?.detector?.candidates?.length||0;
    const truth=trial?.truth||"unreviewed";
    if(truth==="ball_time_unknown")return count?"TP — wykryto kandydata; punkt niezweryfikowany":"FN — kontakt bez wykrycia";
    if(truth==="no_ball")return count?"FP — wykrycie bez kontaktu":"TN — prawidłowy brak wykrycia";
    return "Oczekuje na ręczną ocenę";
}
function gazelaDetectorRender() {
    const trial=contactSelectedTrial();
    const result=document.getElementById("contactDetectorResult");
    const details=document.getElementById("contactDetectorExplain");
    const comparison=document.getElementById("contactDetectorComparison");
    if(!result||!details||!comparison)return;
    if(!trial){result.textContent="Nagraj próbę, aby uruchomić analizę offline.";details.textContent="—";comparison.textContent="—";return;}
    const d=trial.detector;
    if(!d){result.textContent="Brak analizy — próba nieukończona.";details.textContent="—";comparison.textContent="—";return;}
    result.textContent=d.candidates.length?
        "CONTACT CANDIDATE — "+d.candidates.length+" zdarzeń (eksperymentalne)":
        "NO CANDIDATE — algorytm nie znalazł sygnatury";
    const c=d.strongest;
    details.textContent=c?
        `Najsilniejszy: próbka ${c.index}, SEQ ${c.sequence}, t=${c.timeMs} ms • ΔACC ${c.deltaAccG.toFixed(3)} g • C ${c.oppositeG.toFixed(3)} g • E20 ${c.e20G.toFixed(3)} g • odpowiedź przeciwna +${c.oppositeDelayMs.toFixed(1)} ms • |GYRO| ${c.gyroDps.toFixed(1)}°/s • SCORE ${c.score}/100 (heurystyka, nie prawdopodobieństwo).`:
        "Nie przekroczono łącznie progów ΔACC, C oraz E20. Brak znacznika kontaktu.";
    comparison.textContent="Walidacja: "+gazelaDetectorTruthAssessment(trial)+" • ocena ręczna: "+(CONTACT_TRIAL_TRUTH[trial.truth]||"Nieoceniona");
}
// END STAGE 8.6 EXPERIMENTAL OFFLINE DETECTOR

// ========================================================
// STAGE 8.8 — GESTURE RECOGNIZER V1 / OFFLINE STREAM REPLAY
// The sole 400 Hz source is a completed Contact Recorder trial (or imported CSV).
// One sample is supplied at a time. Candidate reports are available to this
// recognizer only after a simulated 40-sample detector finalization delay.
// IMPORTANT: Contact Detector V1 itself still analyzes a COMPLETED trial.
// This is NOT live detection, not a firmware implementation and not a validated
// clinical/sport classifier. No training label enters the inference path.
// ========================================================
const GAZELA_GESTURE_REPLAY_VERSION = "GESTURE_V1_STREAM_REPLAY_2026_11";
const GAZELA_GESTURE_REPLAY_CONFIG = Object.freeze({
    minTapGapMs: 180, maxTapGapMs: 650,
    maxTapPreGyroDps: 55, maxTapInstantGyroDps: 180,
    maxBetweenGyroDps: 65, contactFinalizationSamples: 40,
    preExcludeSamples: 16, preWindowSamples: 80,
    historySamples: 512
});
function gazelaGestureMedian(values) {
    if (!values.length) return null;
    const sorted=values.slice().sort((a,b)=>a-b);
    const middle=Math.floor(sorted.length/2);
    return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
}
class GazelaGestureStreamRecognizerV1 {
    constructor(config = GAZELA_GESTURE_REPLAY_CONFIG) {
        this.cfg={...config};
        this.history=[];
        this.events=[];
        this.gestures=[];
        this.accepted=[];
        this.lastSampleIndex=null;
        this.lastSequence=null;
        this.samplesProcessed=0;
        this.integrity="PASS";
        this.diagnostic=[];
    }
    pushSample(sample) {
        const i=Number(sample.index), seq=Number(sample.sequence);
        const vals=[sample.AX,sample.AY,sample.AZ,sample.GX,sample.GY,sample.GZ].map(Number);
        if(!Number.isSafeInteger(i) || !Number.isSafeInteger(seq) || vals.some(v=>!Number.isFinite(v))) {
            this.integrity="FAIL";
            throw new Error("Gesture Replay: nieprawidłowa próbka ACC/GYRO lub SEQ");
        }
        if(this.lastSampleIndex!==null && (i!==this.lastSampleIndex+1 || seq!==this.lastSequence+1)) {
            this.integrity="FAIL";
            throw new Error("Gesture Replay: luka lub zmiana kolejności próbek (index/SEQ)");
        }
        this.lastSampleIndex=i;
        this.lastSequence=seq;
        this.samplesProcessed++;
        this.history.push({index:i,gyro:Math.hypot(Number(sample.GX),Number(sample.GY),Number(sample.GZ))});
        if(this.history.length>this.cfg.historySamples) this.history.shift();
    }
    medianGyro(fromIndex,toIndex) {
        return gazelaGestureMedian(this.history.filter(s=>s.index>=fromIndex && s.index<=toIndex).map(s=>s.gyro));
    }
    candidateFeatures(candidate) {
        const onset=candidate.index;
        const pre=this.medianGyro(onset-this.cfg.preWindowSamples,onset-this.cfg.preExcludeSamples);
        const at=Number(candidate.gyroDps);
        return {
            preGyro200:pre, gyroAt:at,
            tapCompatible:pre!==null && pre<=this.cfg.maxTapPreGyroDps &&
                Number.isFinite(at) && at<=this.cfg.maxTapInstantGyroDps,
            deltaAccG:Number(candidate.deltaAccG), e20G:Number(candidate.e20G)
        };
    }
    pushCandidate(candidate) {
        const i=Number(candidate.index), peak=Number(candidate.peakIndex);
        if (!Number.isInteger(i) || !Number.isInteger(peak) ||
            this.lastSampleIndex < peak + this.cfg.contactFinalizationSamples) {
            throw new Error("Gesture Replay: kandydat podany przed zakończeniem okna detektora");
        }
        const event={
            eventId:"SEQ-"+Number(candidate.sequence), index:i, peakIndex:peak,
            sequence:Number(candidate.sequence), timeMs:Number(candidate.timeMs),
            score:Number(candidate.score),
            detectedAtIndex:this.lastSampleIndex,
            role:"CONTACT_CANDIDATE", features:this.candidateFeatures(candidate)
        };
        this.events.push(event);
        if(this.events.length<2) return event;
        const last=this.events[this.events.length-2];
        const gap=event.timeMs-last.timeMs;
        if (gap < this.cfg.minTapGapMs || gap > this.cfg.maxTapGapMs ||
            !event.features.tapCompatible || !last.features.tapCompatible ||
            last.role==="GESTURE_TAP_2") return event;
        // Look at the movement BETWEEN the two impulses, excluding 40ms after
        // the first and 40ms preceding the second. No later samples are used.
        const between=this.medianGyro(last.index+16,event.index-16);
        if (between===null || between>this.cfg.maxBetweenGyroDps) return event;
        // Guard against inventing a prior shot from the first of only TWO taps:
        // a prior shot must be an independent candidate >=maxTapGapMs earlier.
        const prior=this.events.slice(0,-2).reverse().find(p=>
            !p.role.startsWith("GESTURE_") && !p.role.startsWith("ACCEPTED_") &&
            last.timeMs-p.timeMs >= this.cfg.maxTapGapMs);
        const score=Math.round(Math.max(0,Math.min(100,100-
            (Number(last.features.preGyro200)+Number(event.features.preGyro200))/3-
            Math.max(0,between-12)/2)));
        const recognition={
            type:"DOUBLE_TAP", tap1Id:last.eventId,tap2Id:event.eventId,
            tap1TimeMs:last.timeMs,tap2TimeMs:event.timeMs,
            gapMs:gap,betweenGyroDps:between,heuristicScore:score,
            disposition:prior?"SIMULATED_ACCEPT":"GESTURE_WITHOUT_PRIOR_SHOT",
            pendingShotId:prior?prior.eventId:null,
            // There is no BALL classification here. These are event IDs only.
            simulated:true
        };
        last.role="GESTURE_TAP_1";
        event.role="GESTURE_TAP_2";
        if(prior){prior.role="ACCEPTED_SHOT_CANDIDATE";this.accepted.push(prior.eventId);}
        this.gestures.push(recognition);
        return event;
    }
    result() {
        return {version:GAZELA_GESTURE_REPLAY_VERSION,
            config:{...this.cfg},source:"400Hz_trial_sequential_replay",
            detectorInput:"OFFLINE_V1_COMPLETED_TRIAL_WITH_40_SAMPLE_DELAY",
            samplesProcessed:this.samplesProcessed,integrity:this.integrity,
            events:this.events,gestures:this.gestures,acceptedCandidateIds:this.accepted,
            note:"Symulowane ACCEPT na kandydacie; brak potwierdzenia BALL i brak zapisu w Arduino."};
    }
}
function gazelaGestureReplayTrial(samples, detector=null) {
    // This function does not look at trial type, truth, labels or filename.
    if(!Array.isArray(samples) || samples.length<24)throw new Error("Za mało próbek dla Replay");
    const d=detector||gazelaDetectContactOffline(samples);
    if(d.error)throw new Error("Contact Detector: "+d.error);
    const engine=new GazelaGestureStreamRecognizerV1();
    const ordered=(d.candidates||[]).slice().sort((a,b)=>a.peakIndex-b.peakIndex);
    let next=0;
    for(const sample of samples) {
        engine.pushSample(sample);
        while(next<ordered.length && sample.index>=ordered[next].peakIndex+engine.cfg.contactFinalizationSamples) {
            engine.pushCandidate(ordered[next]);next++;
        }
    }
    const out=engine.result();
    out.unavailableCandidates=ordered.length-next;
    if(out.unavailableCandidates)out.note+=" "+out.unavailableCandidates+" kandydat(ów) przy końcu nagrania bez pełnego okna potwierdzającego.";
    return out;
}
// END STAGE 8.8 STREAM REPLAY ENGINE


const CONTACT_SAMPLE_COUNT = 1600;
const CONTACT_NOMINAL_HZ = 400;
const CONTACT_SAMPLE_PERIOD_US = 1000000 / CONTACT_NOMINAL_HZ; // 2500 us
function contactRelativeTimeMs(index, periodUs = CONTACT_SAMPLE_PERIOD_US) {
    return index * periodUs / 1000;
}
function contactRelativeTimeSeconds(index, trial = null) {
    const periodUs = trial?.samplePeriodUs || CONTACT_SAMPLE_PERIOD_US;
    return index * periodUs / 1000000;
}
function contactTransportReady() {
    return !!(bleTransport && bleTransport.running &&
        bleTransport.commandCharacteristic && bleTransport.contactCaptureCharacteristic);
}
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
    trialTruth: document.getElementById("contactTrialTruth"),
    truthBall: document.getElementById("contactTruthBall"),
    truthNoBall: document.getElementById("contactTruthNoBall"),
    truthUncertain: document.getElementById("contactTruthUncertain"),
    truthClear: document.getElementById("contactTruthClear"),
    zoomRange: document.getElementById("contactZoomRange"),
    zoomText: document.getElementById("contactZoomText"),
    panRange: document.getElementById("contactPanRange"),
    zoomIn: document.getElementById("contactZoomIn"),
    zoomOut: document.getElementById("contactZoomOut"),
    zoomReset: document.getElementById("contactZoomReset"),
    report: document.getElementById("contactReport")
};
const contactCapture = {
    state: "idle", data: [], total: CONTACT_SAMPLE_COUNT, firstSeq: null,
    firstTimeUs: null, expected: 0, retries: 0,
    packetTimer: null, phaseTimer: null, attemptId: 0,
    retryTotal: 0, lastLabel: "ball", capturedAt: null,
    invalidPacketCount: 0, pendingTrial: null, purpose: "contact", gestureKind: null
};
const contactSession = {
    active: false, startedAt: null, endedAt: null,
    id: null, trials: [], failures: [], selectedTrialId: null,
    cursorIndex: null, zoomSize: CONTACT_SAMPLE_COUNT, viewStart: 0
};
const CONTACT_TYPES = {ball: "Uderzenia piłki", air: "Zamach bez kontaktu", hand: "Stuknięcie dłonią", other: "Inne / zakłócenie"};
const CONTACT_LABELS = {ball: "Kontakt piłki", not_ball: "Nie kontakt piłki", uncertain: "Niepewne"};
const CONTACT_MAX_TRIALS = 100;
const CONTACT_TRIAL_TRUTH = {
    unreviewed: "Nieoceniona",
    ball_time_unknown: "Kontakt piłki był — chwila nieznana",
    no_ball: "Nie było kontaktu piłki",
    uncertain: "Nie jestem pewien/pewna"
};
function contactViewBounds(trial) {
    const count = trial?.samples?.length || CONTACT_SAMPLE_COUNT;
    const size = Math.max(20, Math.min(count, contactSession.zoomSize));
    const start = Math.max(0, Math.min(count-size, contactSession.viewStart));
    return {start, end:start+size-1, size, count};
}
function contactSyncZoomUI() {
    const trial=contactSelectedTrial(), bounds=contactViewBounds(trial);
    const active=!!trial && !contactIsBusy();
    for(const b of [contactUI.zoomIn,contactUI.zoomOut,contactUI.zoomReset]) if(b) b.disabled=!active;
    if(contactUI.zoomRange){contactUI.zoomRange.disabled=!active;contactUI.zoomRange.value=String(bounds.size);}
    if(contactUI.panRange){
        contactUI.panRange.disabled=!active || bounds.size>=bounds.count;
        contactUI.panRange.max=String(bounds.count-bounds.size);
        contactUI.panRange.value=String(bounds.start);
    }
    if(contactUI.zoomText) contactUI.zoomText.textContent=`${contactRelativeTimeSeconds(bounds.start, trial).toFixed(3)}–${contactRelativeTimeSeconds(bounds.end, trial).toFixed(3)} s • ${bounds.size} próbek • przybliżenie ${(bounds.count/bounds.size).toFixed(1)}×`;
}
function contactSetZoom(nextSize, newStart=null) {
    const trial=contactSelectedTrial();if(!trial)return;
    const old=contactViewBounds(trial);
    const size=Math.min(trial.samples.length,Math.max(20,Math.round(nextSize)));
    const center=contactSession.cursorIndex!==null?contactSession.cursorIndex:old.start+(old.size-1)/2;
    const start=newStart===null?Math.round(center-(size-1)/2):Math.round(newStart);
    contactSession.zoomSize=size;
    contactSession.viewStart=Math.max(0,Math.min(trial.samples.length-size,start));
    contactRenderTrial();contactRefresh();
}
function contactSetTrialTruth(value) {
    const trial=contactSelectedTrial();if(!trial || contactIsBusy())return;
    trial.truth=value;trial.truthAt=new Date().toISOString();
    // Important: does NOT insert a precise time marker or invent a sample index.
    contactRenderTrial();contactRefresh();
}
function contactRenderTruth() {
    const trial=contactSelectedTrial();
    if(contactUI.trialTruth)contactUI.trialTruth.textContent=trial?`Ocena całej próby: ${CONTACT_TRIAL_TRUTH[trial.truth||"unreviewed"]}`:"Najpierw nagraj próbę.";
    for(const [element,value] of [[contactUI.truthBall,"ball_time_unknown"],[contactUI.truthNoBall,"no_ball"],[contactUI.truthUncertain,"uncertain"],[contactUI.truthClear,"unreviewed"]]){
        if(element){element.disabled=!trial || contactIsBusy();element.setAttribute("aria-pressed",String(!!trial && (trial.truth||"unreviewed")===value));}
    }
}
 
 
function contactSetStatus(message, forceContact=false) {
    if (!forceContact && contactCapture.purpose === "gesture") { window.GazelaSignatureLab?.status(message); return; }
    if (!forceContact && contactCapture.purpose === "comparator") { window.GazelaSignatureLab?.comparatorStatus(message); return; }
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
        confirmedTrials:trials.filter(t=>t.truth === "ball_time_unknown").length,
        excludedTrials:trials.filter(t=>t.truth === "no_ball").length,
 
        uncertainTrials:trials.filter(t=>t.truth === "uncertain").length,
        unreviewedTrials:trials.filter(t=>!t.truth || t.truth === "unreviewed").length,
        notBall: markers.filter(m => m.label === "not_ball").length,
        uncertain: markers.filter(m => m.label === "uncertain").length,
        retries: trials.reduce((n,t) => n + t.retries,0),
        errors: contactSession.failures.length
    };
}
// V61 — presentation only. Keep each module's last capture visible until its next capture.
// Count only CRC16/SEQ-verified packets already appended by the shared BLE engine.
function gestureTransferRefresh() {
    const prefix = {gesture: "gsl", comparator: "gc"}[contactCapture.purpose];
    if (!prefix) return;
    const panel = document.getElementById(prefix + "Transfer");
    const samples = document.getElementById(prefix + "TransferSamples");
    const percent = document.getElementById(prefix + "TransferPercent");
    const bar = document.getElementById(prefix + "TransferBar");
    const phase = document.getElementById(prefix + "TransferPhase");
    if (!panel || !samples || !percent || !bar || !phase) return;
    const state = contactCapture.state;
    const total = contactCapture.total;
    const received = Math.min(total, contactCapture.data.length);
    const labels = {
        starting: "STARTING — oczekiwanie na CAP,STARTED",
        recording: "RECORDING — wykonaj gest teraz (~4 s)",
        downloading: "DOWNLOADING — odbiór i kontrola CRC16 + SEQ",
        finalizing: "FINALIZING — 1600/1600; oczekiwanie na CAP,DONE",
        done: "DONE — CAP,DONE PASS; nagranie zapisane w module",
        failed: "FAILED — próba nieukończona; sprawdź komunikat",
        idle: "CANCELLED — próba anulowana"
    };
    panel.dataset.phase = state;
    samples.textContent = `${received} / ${total}`;
    percent.textContent = `${Math.floor(100 * received / total)}%`;
    bar.max = total;
    bar.value = received;
    phase.textContent = labels[state] || state.toUpperCase();
}
function contactRefresh() {
    gestureTransferRefresh();
    const busy = contactIsBusy();
    const active = contactSession.active;
    const trial = contactSelectedTrial();
    const st = contactStats();
    if (contactUI.start) contactUI.start.disabled = !active || !contactTransportReady() || measuring || busy || st.trials >= CONTACT_MAX_TRIALS;
    if (contactUI.cancel) contactUI.cancel.disabled = !busy || contactCapture.purpose !== "contact" || contactCapture.state === "finalizing";
    if (contactUI.download) contactUI.download.disabled = !trial || busy;
    if (contactUI.label) contactUI.label.disabled = !active || busy;
    if (contactUI.sessionStart) contactUI.sessionStart.disabled = active || busy;
    if (contactUI.sessionEnd) contactUI.sessionEnd.disabled = !active || busy;
    if (contactUI.sessionExport) contactUI.sessionExport.disabled = st.trials === 0 || busy;
    if (contactUI.samples) contactUI.samples.textContent = `${contactCapture.data.length} / ${contactCapture.total}`;
    if (contactUI.phase) contactUI.phase.textContent = contactCapture.state.toUpperCase();
    if (contactUI.integrity) contactUI.integrity.textContent = contactCapture.state === "done" ? "PASS" : contactCapture.state === "failed" ? "FAIL" : "—";
    if (contactUI.trialCount) contactUI.trialCount.textContent = `${st.trials} / ${st.trials}`;
    if (contactUI.sampleCount) contactUI.sampleCount.textContent = String(st.samples);
    if (contactUI.confirmedCount) contactUI.confirmedCount.textContent = String(st.ball) + " punktów / " + String(st.confirmedTrials) + " prób";
    if (contactUI.sessionBadge) contactUI.sessionBadge.textContent = active ? "Sesja aktywna" : contactSession.startedAt ? "Sesja zakończona" : "Brak sesji";
    if (contactUI.trialSelect) contactUI.trialSelect.disabled = st.trials === 0 || busy;
    const canMark = !!trial && contactSession.cursorIndex !== null && !busy;
    for (const button of [contactUI.markTrue, contactUI.markNegative, contactUI.markUncertain]) {
        if (button) button.disabled = !canMark;
    }
    contactSyncZoomUI();
    contactRenderTruth();
    contactRenderReport();
    window.GazelaSignatureLab?.refresh();
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
    const validConnection = contactTransportReady();
    contactClearTimers();
    contactCapture.attemptId++;
    // A transfer that failed before CAP,DONE must NEVER enter the dataset.
    contactCapture.pendingTrial = null;
    contactCapture.state = "failed";
    if(contactCapture.purpose==="contact")contactSession.failures.push({at:new Date().toISOString(),phase:oldState,error:message});
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
    contactSession.zoomSize = CONTACT_SAMPLE_COUNT;contactSession.viewStart = 0;
    contactCapture.state = "idle";
    contactCapture.purpose = "contact";
    contactCapture.data = [];
    contactCapture.pendingTrial = null;
    contactSetStatus("Sesja rozpoczęta. Wybierz rodzaj próby, nagraj ok. 4 sekundy (1600 próbek @ 400 Hz) i oznacz kontakty na wykresach.");
    contactRenderTrialSelect();
    contactRenderTrial();
    contactRefresh();
}
function contactEndSession() {
    if (!contactSession.active || contactIsBusy()) return;
    contactSession.active = false;
    contactCapture.purpose = "contact";
    contactSession.endedAt = new Date().toISOString();
    contactSetStatus("Sesja zakończona. Sprawdź oznaczenia i pobierz ZIP z próbkami, etykietami oraz raportem.");
    contactRefresh();
}
async function contactStart(purpose = "contact", gestureKind = null) {
    // Existing click listener passes a DOM event, so only the explicit string selects gesture capture.
    purpose = ["gesture","comparator"].includes(purpose) ? purpose : "contact";
    if ((purpose === "contact" && (!contactSession.active || contactSession.trials.length >= CONTACT_MAX_TRIALS)) || (purpose !== "contact" && !window.GazelaSignatureLab) || !contactTransportReady() || measuring || contactIsBusy()) return;
    contactClearTimers();
 
    Object.assign(contactCapture, {
        purpose,gestureKind,state:"starting",data:[],total:CONTACT_SAMPLE_COUNT,firstSeq:null,firstTimeUs:null,
        expected:0,retries:0,retryTotal:0,invalidPacketCount:0,pendingTrial:null,
        lastLabel:contactUI.label?.value || "ball",capturedAt:new Date().toISOString()
    });
    contactCapture.attemptId++;
    contactSetStatus("Oczekiwanie na start rejestracji ~4 s / 1600 próbek / 400 Hz w Arduino. Próbę wykonaj tuż po starcie.");
    contactRefresh();
    contactPhaseTimeout(10000,"brak potwierdzenia CAP,STARTED przez BLE",["starting"]);
    try { await bleTransport.send("C"); }
    catch(e) { contactFail(e.message); }
}
async function contactCancel() {
    if (!contactIsBusy() || contactCapture.state === "finalizing") return;
    contactCapture.attemptId++;
    contactClearTimers();
    contactCapture.state = "idle";
    contactCapture.data = [];
    contactCapture.pendingTrial = null;
    contactSetStatus("Próba anulowana. Dotychczasowe ukończone i potwierdzone próby są zachowane.");
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
        if (Number(fields[2]) !== CONTACT_SAMPLE_COUNT) { contactFail("Niezgodna wersja firmware: CAP,STARTED="+fields[2]+", oczekiwano "+CONTACT_SAMPLE_COUNT); return; }
        contactCapture.state = "recording";
        contactSetStatus(contactCapture.purpose !== "contact" ? "Rejestracja trwa — wykonaj wybrany gest lub próbę kontrolną teraz (~4 s)." : "Rejestracja trwa — okno ok. 4 s (1600 próbek @ 400 Hz). Uderz piłkę lub wykonaj próbę kontrolną teraz.");
        contactRefresh();
        contactPhaseTimeout(11000,"brak CAP,READY po nagrywaniu",["recording"]);
        return;
    }
    if (type === "PROGRESS" && contactCapture.state === "recording") {
        contactSetStatus("Rejestrowanie w pamięci Arduino: " + fields[2] + " / " + CONTACT_SAMPLE_COUNT + " próbek…");
        return;
    }
    if (type === "READY" && contactCapture.state === "recording") {
        const total = Number(fields[2]);
        const seq = Number(fields[3]);
        const time = Number(fields[4]);
        if (total !== CONTACT_SAMPLE_COUNT || !Number.isSafeInteger(seq) || seq < 1 || !Number.isSafeInteger(time) || time < 0 || time > 0xFFFFFFFF) {
            contactFail("nieprawidłowe metadane CAP,READY"); return;
        }
        if (contactCapture.phaseTimer) clearTimeout(contactCapture.phaseTimer);
        contactCapture.phaseTimer = null;
        Object.assign(contactCapture,{total,firstSeq:seq,firstTimeUs:time,state:"downloading",expected:0,retries:0});
        contactSetStatus("Zebrano 1600 próbek (~4 s @ 400 Hz). Pobieranie ramek i weryfikacja CRC16 oraz SEQ przez BLE…");
        contactRefresh();
        contactRequest(0);
        return;
    }
    if (type === "DONE" && contactCapture.state === "finalizing") {
        // Commit to the session ONLY after the firmware confirms CAP,DONE.
        // No partially downloaded or unacknowledged trial enters the export.
        const trial = contactCapture.pendingTrial;
        if (!trial || trial.samples.length !== CONTACT_SAMPLE_COUNT ||
            trial.lastSeq !== ((trial.firstSeq + CONTACT_SAMPLE_COUNT - 1) >>> 0)) {
            contactFail("CAP,DONE bez poprawnej, oczekującej próby");
            return;
        }
        contactClearTimers();
        if (contactCapture.purpose !== "contact") {
            trial.completedAt = new Date().toISOString();
            trial.transportFinalized = true;
            contactCapture.pendingTrial = null;
            contactCapture.state = "done";
            try {
                if (contactCapture.purpose === "comparator") window.GazelaSignatureLab.commitComparator(trial);
                else window.GazelaSignatureLab.commit(trial,contactCapture.gestureKind);
            }
            catch(error) { contactCapture.state = "failed"; console.error("Gesture Lab commit",error); }
            contactRefresh();
            return;
        }
        trial.id = contactSession.trials.length + 1;
        trial.completedAt = new Date().toISOString();
        trial.transportFinalized = true;
        // Analyze only committed/verified trials, never pending transfers.
        trial.detector = gazelaDetectContactOffline(trial.samples);
        trial.detectorAnalyzedAt = new Date().toISOString();
        // Stage 8.8 replay is read-only and cannot prevent a verified CAP,DONE commit.
        try { trial.gestureReplay = gazelaGestureReplayTrial(trial.samples, trial.detector); }
        catch(error) { trial.gestureReplayError = error.message; console.warn("Gesture Replay:",error); }
        contactSession.trials.push(trial);
        contactSession.selectedTrialId = trial.id;
        // Audio happens after the full BLE download and CAP,DONE (not on court impact).
        if(trial.detector.strongest && window.GazelaContactFeedback) {
            window.GazelaContactFeedback.emitCandidate({
                eventId: contactSession.id + ":" + trial.id,
                seq: trial.detector.strongest.sequence
            });
        }
        contactSession.cursorIndex = null;
        contactSession.zoomSize = CONTACT_SAMPLE_COUNT;
        contactSession.viewStart = 0;
        contactCapture.pendingTrial = null;
        contactCapture.state = "done";
        contactSetStatus("Próba #" + trial.id + " potwierdzona CAP,DONE: 1600/1600 CRC16 + SEQ PASS. Zapisana w sesji. Oznacz kontakt na wykresach.");
        contactRenderTrialSelect();
        contactRenderTrial();
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
        index, sequence, time_ms:contactRelativeTimeMs(index),
        sensor_time_us_nominal: ((contactCapture.firstTimeUs + index*CONTACT_SAMPLE_PERIOD_US) >>> 0),
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
    if (contactCapture.state !== "downloading") return;
    contactClearTimers();
    const samples = contactCapture.data.map(s=>({...s}));
    const firstSeq = contactCapture.firstSeq;
    const lastSeq = samples.at(-1)?.sequence;
    if (samples.length !== CONTACT_SAMPLE_COUNT ||
        lastSeq !== ((firstSeq + CONTACT_SAMPLE_COUNT - 1) >>> 0)) {
        contactFail("niekompletny zapis 1600 próbek");
        return;
    }
    // Stage 8.4 two-phase commit: a complete and verified transfer is not yet
    // a completed trial. The trial is provisional until CAP,DONE arrives.
    contactCapture.pendingTrial = {
        id:null, type:contactCapture.lastLabel,
        capturedAt:contactCapture.capturedAt, completedAt:null,
        firstSeq, lastSeq, firstTimeUs:contactCapture.firstTimeUs,
        samplePeriodUs:CONTACT_SAMPLE_PERIOD_US, count:samples.length,
        integrity:"PASS", transportFinalized:false,
        retries:contactCapture.retryTotal,
        invalidPackets:contactCapture.invalidPacketCount,
        samples, markers:[], truth:"unreviewed", truthAt:null
    };
    contactCapture.state = "finalizing";
    contactSetStatus("Pobrano 1600/1600 próbek — CRC16 i SEQ PASS. Oczekiwanie na CAP,DONE; próba NIE jest jeszcze zapisana w sesji.");
    contactRefresh();
    contactPhaseTimeout(9000,"brak potwierdzenia CAP,DONE — próba NIE została dodana do sesji",["finalizing"]);
    if (contactTransportReady()) bleTransport.send("F").catch(e=>contactFail("finalizacja BLE: "+e.message));
    else contactFail("BLE rozłączone przed CAP,DONE");
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
        option.value=String(t.id);option.textContent="#"+t.id+" — "+(CONTACT_TYPES[t.type]||t.type)+" (1600 próbek)";
        el.appendChild(option);
    }
    el.value=String(contactSession.selectedTrialId);
}
// Shared axis palette: CONTACT RECORDER and LIVE SENSOR use identical colors.
const GAZELA_AXIS_COLORS = ["#dc2626", "#2563eb", "#16a34a"]; // X red, Y blue, Z green
function contactCanvasPlot(canvas, samples, channels) {
    if (!canvas) return;
    const rect=canvas.getBoundingClientRect();
    const width=Math.max(260,Math.floor(rect.width || 620));
    const height=250;
    const pixelRatio=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(width*pixelRatio);
    canvas.height=Math.round(height*pixelRatio);
    const ctx=canvas.getContext("2d");if(!ctx)return;
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    ctx.clearRect(0,0,width,height);
    const left=49,right=width-13,top=18,bottom=height-36;
    ctx.strokeStyle="#e2e8f0";ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
        const y=top+(bottom-top)*i/4;
        ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
    }
    ctx.font="11px Arial";ctx.fillStyle="#64748b";
    if(!samples || samples.length<2){ctx.fillText("Brak pobranych próbek",left+12,height/2);return;}
    const trial=contactSelectedTrial();
    const {start,end,size}=contactViewBounds(trial);
    const visible=samples.slice(start,end+1);
    const vals=channels.flatMap(ch=>visible.map(x=>x[ch]).filter(Number.isFinite));
    let min=Math.min(...vals),max=Math.max(...vals);
    const extra=Math.max(0.01,(max-min)*0.08);min-=extra;max+=extra;
    const span=Math.max(0.01,max-min);
    ctx.fillText(max.toFixed(2),2,top+4);ctx.fillText(min.toFixed(2),2,bottom);
    // Draw axis and waveforms only for visible portion, maintaining full sample fidelity.
    const tickCount=4;
    for(let i=0;i<=tickCount;i++){
        const index=start+(end-start)*i/tickCount;
        const x=left+(right-left)*i/tickCount;
        const label=contactRelativeTimeSeconds(index, trial).toFixed(3)+"s";
        ctx.fillStyle="#64748b";
        ctx.fillText(label,Math.max(0,Math.min(width-39,x-18)),bottom+30);
    }
    const colors=GAZELA_AXIS_COLORS;
    for(let k=0;k<channels.length;k++){
 
        ctx.strokeStyle=colors[k];ctx.lineWidth=1.45;ctx.beginPath();
        for(let index=start;index<=end;index++){
            const x=left+(right-left)*(index-start)/(size-1);
            const y=bottom-(samples[index][channels[k]]-min)/span*(bottom-top);
            if(index===start)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.stroke();ctx.fillStyle=colors[k];ctx.fillText(channels[k],left+k*51,top+11);
    }
    if(trial){
        for(const m of trial.markers){
            if(m.index<start || m.index>end)continue;
            const x=left+(right-left)*(m.index-start)/(size-1);
            ctx.strokeStyle=m.label==="ball"?"#059669":m.label==="not_ball"?"#e11d48":"#d97706";
            ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
        }
    }
    if(trial?.detector?.candidates?.length){
        for(const candidate of trial.detector.candidates){
            if(candidate.index<start||candidate.index>end)continue;
            const x=left+(right-left)*(candidate.index-start)/(size-1);
            ctx.strokeStyle="#7c3aed";ctx.lineWidth=1.8;ctx.setLineDash([3,4]);
            ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);
            ctx.fillStyle="#7c3aed";ctx.font="10px Arial";ctx.fillText("AI?",Math.min(right-23,x+3),top+22);
        }
    }
    // Stage 8.8: gesture overlay only; original detector candidates remain visible.
    if(trial?.gestureReplay?.events?.length){
        for(const ev of trial.gestureReplay.events){
            if(ev.index<start||ev.index>end || ev.role==="CONTACT_CANDIDATE")continue;
            const x=left+(right-left)*(ev.index-start)/(size-1);
            const accepted=ev.role==="ACCEPTED_SHOT_CANDIDATE";
            const label=accepted?"ACCEPT?":ev.role==="GESTURE_TAP_1"?"TAP 1":"TAP 2";
            ctx.strokeStyle=accepted?"#059669":"#d97706";ctx.lineWidth=2.1;
            ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
            ctx.fillStyle=ctx.strokeStyle;ctx.font="10px Arial";
            ctx.fillText(label,Math.min(right-48,x+3),top+37);
        }
    }
    if(contactSession.cursorIndex!==null && contactSession.cursorIndex>=start && contactSession.cursorIndex<=end){
        const x=left+(right-left)*(contactSession.cursorIndex-start)/(size-1);
        ctx.strokeStyle="#111827";ctx.lineWidth=1;ctx.setLineDash([4,3]);
        ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);
    }
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
    contactSyncZoomUI();
    contactRenderTruth();
    gazelaDetectorRender();
    if(window.GazelaGestureReplayUI)window.GazelaGestureReplayUI.renderCurrent();
}
function contactChooseSample(event) {
    const trial=contactSelectedTrial();if (!trial || contactIsBusy()) return;
    const canvas=event.currentTarget;
    const rect=canvas.getBoundingClientRect();
    const width=Math.max(260,Math.floor(rect.width||620));
    const left=49,right=width-13; // identical margins to contactCanvasPlot()
    const px=event.clientX-rect.left;
    const {start,size}=contactViewBounds(trial);
    const index=start+Math.round(Math.max(0,Math.min(1,(px-left)/(right-left)))*(size-1));
    contactSession.cursorIndex=index;
    contactRenderTrial();contactRefresh();
}
function contactAddMarker(label) {
    const trial=contactSelectedTrial();
    const index=contactSession.cursorIndex;
    if(!trial || index===null || contactIsBusy()) return;
    let marker=trial.markers.find(m=>m.index===index);
    if(marker) { marker.label=label;marker.updatedAt=new Date().toISOString(); }
    else trial.markers.push({index,sequence:trial.samples[index].sequence,time_ms:trial.samples[index].time_ms,label,updatedAt:new Date().toISOString(),source:"human"});
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
        label.textContent=`#${trial.id} • ${marker.time_ms} ms • SEQ ${marker.sequence} • ${CONTACT_LABELS[marker.label]}`;
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
        ["Kontakty oznaczone w punktach",st.ball],["Próby: był kontakt (bez czasu)",st.confirmedTrials],
        ["Próby: brak kontaktu",st.excludedTrials],["Próby: niepewne",st.uncertainTrials],
        ["Próby: nieocenione",st.unreviewedTrials],["Nie kontakt piłki (punkty)",st.notBall],
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
    p.textContent="Kompletność: "+(st.trials?"1600/1600 próbek na próbę, CRC16 + SEQ PASS i potwierdzenie CAP,DONE":"brak prób")+". Każde okno to nominalnie 4,000 s przy 400 Hz (próbki od 0,000 do 3,9975 s). Przerwy między próbami NIE są rejestrowane. Detektor OFFLINE V1 analizuje ukończone próby; wynik nie zmienia ręcznych oznaczeń. Dźwięk dopiero po transmisji BLE. Firmware nie ma detektora.";
    el.appendChild(p);
}
function contactCSVCell(value) {
    const s=String(value??"");
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function contactCSV(rows) {return rows.map(r=>r.map(contactCSVCell).join(",")).join("\r\n")+"\r\n";}
function contactTrialCSV(trial) {
    const marks=new Map(trial.markers.map(m=>[m.index,m.label]));
    const rows=[["session_id","trial_id","trial_type","index","sequence","sensor_time_us_nominal","time_ms","AX_g","AY_g","AZ_g","G_g","GX_dps","GY_dps","GZ_dps","gyro_magnitude_dps","reference_label","trial_truth"]];
    for(const s of trial.samples) rows.push([
        contactSession.id,trial.id,trial.type,s.index,s.sequence,s.sensor_time_us_nominal,s.time_ms,
        s.AX,s.AY,s.AZ,Math.hypot(s.AX,s.AY,s.AZ).toFixed(5),
        s.GX,s.GY,s.GZ,Math.hypot(s.GX,s.GY,s.GZ).toFixed(3),marks.get(s.index)||"",trial.truth||"unreviewed"
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
        schema:"gazela.contact.session.v3",sessionId:contactSession.id,
        startedAt:contactSession.startedAt,endedAt:contactSession.endedAt,
        exportedAt:new Date().toISOString(),
        firmware:"V28.1 HR400 (expected; not remotely attested)",frontend:"V61 / Stage 8.9 LOCAL REFERENCE LIBRARY HR400",
        sensor:"BMI270 ACC+GYRO",sampleRateNominalHz:CONTACT_NOMINAL_HZ,
        samplePeriodUsNominal:CONTACT_SAMPLE_PERIOD_US, samplesPerTrial:CONTACT_SAMPLE_COUNT,
        nominalCaptureDurationMs:CONTACT_SAMPLE_COUNT * CONTACT_SAMPLE_PERIOD_US / 1000,
        captureMode:"independent 1600-sample (~4 second) trials; gaps between trials are NOT recorded; commit requires CAP,DONE",
        quantization:{acc_g:0.001,gyro_dps:0.1},
        detector:{implementedInFirmware:false,offlineImplemented:true,version:GAZELA_OFFLINE_DETECTOR_VERSION,
            configuration:{...GAZELA_DETECTOR_CONFIG},note:"Thresholds exploratory; only 400 Hz recording after CAP,DONE"},
        gestureRecognizer:{implementedInFirmware:false,offlineReplay:true,version:GAZELA_GESTURE_REPLAY_VERSION,
            configuration:{...GAZELA_GESTURE_REPLAY_CONFIG},note:"Gesture Replay processes samples sequentially but detector input is calculated offline from completed trial. ACCEPT simulated only."},
        labels:{authority:"user_manual",timing:"point markers optional, trial-level truth may have no timestamp",trialTruthValues:Object.keys(CONTACT_TRIAL_TRUTH)},
        stats,trials:contactSession.trials.map(t=>({id:t.id,type:t.type,capturedAt:t.capturedAt,
            completedAt:t.completedAt,firstSeq:t.firstSeq,lastSeq:t.lastSeq,
            firstTimeUs:t.firstTimeUs,count:t.samples.length,integrity:t.integrity,
            samplePeriodUs:t.samplePeriodUs,nominalCaptureDurationMs:t.samples.length*t.samplePeriodUs/1000,
            finalizedByFirmwareAck:t.transportFinalized === true,
            retries:t.retries,invalidPackets:t.invalidPackets,truth:t.truth||"unreviewed",truthAt:t.truthAt,markers:t.markers,
            detector:t.detector,detectorAnalyzedAt:t.detectorAnalyzedAt,
            gestureReplay:t.gestureReplay||null,gestureReplayError:t.gestureReplayError||null,
            detectorComparison:gazelaDetectorTruthAssessment(t)})),
 
        failures:contactSession.failures
    };
    const rows=[["session_id","trial_id","trial_type","index","sequence","time_ms","label","source","updated_at"]];
    for(const t of contactSession.trials) {
        // Trial-level assessment has no point, sequence, or timestamp by design.
        if(t.truth && t.truth!=="unreviewed") rows.push([contactSession.id,t.id,t.type,"","","",t.truth,"human_trial",t.truthAt||""]);
        for(const m of t.markers) rows.push([contactSession.id,t.id,t.type,m.index,m.sequence,m.time_ms,m.label,m.source,m.updatedAt]);
    }
    const report=[
        "GAZELA SPINER SENSOR — CONTACT RECORDER V3 / STAGE 8.4 HR400 4S",`Session: ${contactSession.id}`,
        `Started: ${contactSession.startedAt}`,`Ended: ${contactSession.endedAt||"still active"}`,
        `Trials completed: ${stats.trials}`,`CRC/SEQ-verified samples: ${stats.samples}`,
        `Manually labeled ball contacts at points: ${stats.ball}`,`Trials with confirmed ball contact but unknown exact time: ${stats.confirmedTrials}`,`Trials with no ball: ${stats.excludedTrials}`,`Trials uncertain: ${stats.uncertainTrials}`,`Trials unreviewed: ${stats.unreviewedTrials}`,`Manually marked non-ball: ${stats.notBall}`,
        `Uncertain labels: ${stats.uncertain}`,`BLE packet retries: ${stats.retries}`,
        `Failed trials: ${stats.errors}`,
        "No contact detector in firmware V28.1. Offline experimental detection follows CAP,DONE; sound occurs after BLE transfer.",
        ...contactSession.trials.map(t=>`Trial ${t.id}: ${t.detector?.candidates?.length||0} candidates, ${gazelaDetectorTruthAssessment(t)}`),
        "Each trial contains 1600 samples, nominal 400 Hz / 2.5 ms steps (~4.000 s).",
        "Last sample is indexed 1599 at relative 3997.5 ms (1600 sample intervals represent 4000 ms).",
        "Only CAP,DONE-acknowledged trials are committed. Failed or cancelled attempts are not exported as trials.",
        "Gaps between 4-second trials are NOT recorded. No BLE packet timing is used as sensor time.",
        "Sensor timestamps are reconstructed at nominal 400 Hz and are NOT hardware BMI270 timestamps."
    ].join("\n")+"\n";
    const files=[
        ["README.txt","GAZELA CONTACT RECORDER V3 / STAGE 8.4 HR400 4S\nEach trial_XXX.csv contains 1600 samples at nominal 400 Hz (2.5 ms / sample; window ~4 s). Timestamps are firmware-reconstructed, not hardware BMI270 SensorTime.\nOnly trials with confirmed CAP,DONE are committed. Failed trials are described in session.json failures.\ntrial_truth is a manual label and does not imply an exact impact timestamp. labels.csv contains point labels and trial-level human labels; for trial-level truth, index/SEQ/time are deliberately blank.\nGaps between independent trials are not recorded. An experimental OFFLINE detector analyzes completed trials only; audio plays AFTER BLE transfer and CAP,DONE. Firmware contains no ball-impact detector.\n"],
        ["report.txt",report],
        ["session.json",JSON.stringify(meta,null,2)+"\n"],
        ["labels.csv",contactCSV(rows)]
    ];
    const detectorRows=[["session_id","trial_id","detector_version","candidate_number","onset_index","peak_index","sequence","time_ms_nominal","delta_acc_g","opposition_c_g","e20_g","opposite_delay_ms","gyro_dps","heuristic_score_0_100","trial_truth","trial_comparison"]];
    for(const trial of contactSession.trials){
        for(const [i,c] of (trial.detector?.candidates||[]).entries()) detectorRows.push([
            contactSession.id,trial.id,GAZELA_OFFLINE_DETECTOR_VERSION,i+1,c.index,c.peakIndex,c.sequence,c.timeMs,
            c.deltaAccG.toFixed(6),c.oppositeG.toFixed(6),c.e20G.toFixed(6),c.oppositeDelayMs,c.gyroDps.toFixed(3),c.score,
            trial.truth||"unreviewed",gazelaDetectorTruthAssessment(trial)]);
        if(!(trial.detector?.candidates||[]).length)detectorRows.push([
            contactSession.id,trial.id,GAZELA_OFFLINE_DETECTOR_VERSION,"","","","","","","","","","","",trial.truth||"unreviewed",gazelaDetectorTruthAssessment(trial)]);
    }
    files.push(["detector_candidates.csv",contactCSV(detectorRows)]);
    const gestureRows=[["session_id","trial_id","gesture_version","event_id","sequence","time_ms","gyro_pre_200_dps","gyro_at_dps","role","tap_compatible"]];
    const gestureMatches=[["session_id","trial_id","tap1_id","tap2_id","gap_ms","gyro_between_dps","disposition","pending_shot_event_id"]];
    for(const t of contactSession.trials){
        for(const e of (t.gestureReplay?.events||[]))gestureRows.push([
            contactSession.id,t.id,GAZELA_GESTURE_REPLAY_VERSION,e.eventId,e.sequence,e.timeMs,
            e.features.preGyro200??"",e.features.gyroAt,e.role,e.features.tapCompatible]);
        for(const g of (t.gestureReplay?.gestures||[]))gestureMatches.push([
            contactSession.id,t.id,g.tap1Id,g.tap2Id,g.gapMs,g.betweenGyroDps,g.disposition,g.pendingShotId||""]);
    }
    files.push(["gesture_replay_events.csv",contactCSV(gestureRows)]);
    files.push(["gesture_replay_gestures.csv",contactCSV(gestureMatches)]);
    for(const t of contactSession.trials) files.push([
        "trial_"+String(t.id).padStart(3,"0")+"_"+t.type+".csv",contactTrialCSV(t)
    ]);
    try {
        const blob=contactBuildZip(files);
        contactSaveBlob("GAZELA_CONTACT_"+contactSession.id+".zip",blob);
        contactSetStatus("Zapisano archiwum ZIP: "+stats.trials+" prób, "+stats.samples+" próbek, "+stats.ball+" ręcznie oznaczonych kontaktów.",true);
    }catch(e) {
        contactSetStatus("Błąd eksportu ZIP: "+e.message,true);
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
        contactSession.selectedTrialId=id;contactSession.cursorIndex=null;contactSession.zoomSize=CONTACT_SAMPLE_COUNT;contactSession.viewStart=0;
        contactRenderTrial();contactRefresh();
    }
});
if(contactUI.accChart)contactUI.accChart.addEventListener("click",contactChooseSample);
if(contactUI.gyroChart)contactUI.gyroChart.addEventListener("click",contactChooseSample);
if(contactUI.truthBall)contactUI.truthBall.addEventListener("click",()=>contactSetTrialTruth("ball_time_unknown"));
if(contactUI.truthNoBall)contactUI.truthNoBall.addEventListener("click",()=>contactSetTrialTruth("no_ball"));
if(contactUI.truthUncertain)contactUI.truthUncertain.addEventListener("click",()=>contactSetTrialTruth("uncertain"));
if(contactUI.truthClear)contactUI.truthClear.addEventListener("click",()=>contactSetTrialTruth("unreviewed"));
if(contactUI.zoomRange)contactUI.zoomRange.addEventListener("input",value=>contactSetZoom(Number(value.target.value)));
if(contactUI.panRange)contactUI.panRange.addEventListener("input",value=>contactSetZoom(contactSession.zoomSize,Number(value.target.value)));
if(contactUI.zoomIn)contactUI.zoomIn.addEventListener("click",()=>contactSetZoom(contactSession.zoomSize/2));
if(contactUI.zoomOut)contactUI.zoomOut.addEventListener("click",()=>contactSetZoom(contactSession.zoomSize*2));
if(contactUI.zoomReset)contactUI.zoomReset.addEventListener("click",()=>contactSetZoom(CONTACT_SAMPLE_COUNT,0));
if(contactUI.markTrue)contactUI.markTrue.addEventListener("click",()=>contactAddMarker("ball"));
if(contactUI.markNegative)contactUI.markNegative.addEventListener("click",()=>contactAddMarker("not_ball"));
if(contactUI.markUncertain)contactUI.markUncertain.addEventListener("click",()=>contactAddMarker("uncertain"));
window.addEventListener("resize",()=>contactRenderTrial());
contactRenderTrial();
contactRefresh();
 
// ========================================================
// V55 LIVE SENSOR CHARTS - UI ONLY
// Uses existing validated LIVE frames. No sensor or transport changes.
// ========================================================
const liveWaveAccCanvas = document.getElementById("liveWaveAcc");
const liveWaveGyroCanvas = document.getElementById("liveWaveGyro");
const liveWavePauseButton = document.getElementById("liveWavePause");
const liveWaveClearButton = document.getElementById("liveWaveClear");
const liveWaveState = document.getElementById("liveWaveState");
const LIVE_WAVE_WINDOW_MS = 8000;
const LIVE_WAVE_MAX_POINTS = 650;
const LIVE_WAVE_FRAME_INTERVAL_MS = 90;
const liveWaveSamples = [];
let liveWavePaused = false;
let liveWaveLastRender = 0;
let liveWavePendingFrame = false;
let liveWaveLastSampleMs = null;
 
function liveWaveReceiveSample(values) {
    if (!liveWaveAccCanvas || !liveWaveGyroCanvas || liveWavePaused) return;
    const now = performance.now();
    liveWaveLastSampleMs = now;
    liveWaveSamples.push({ t: now, ...values });
    const cutoff = now - LIVE_WAVE_WINDOW_MS;
    while (liveWaveSamples.length && liveWaveSamples[0].t < cutoff) liveWaveSamples.shift();
    if (liveWaveSamples.length > LIVE_WAVE_MAX_POINTS) {
        liveWaveSamples.splice(0, liveWaveSamples.length - LIVE_WAVE_MAX_POINTS);
    }
    if (liveWaveState) liveWaveState.textContent = "LIVE • " + liveWaveSamples.length + " ramek";
    if (!liveWavePendingFrame && now - liveWaveLastRender >= LIVE_WAVE_FRAME_INTERVAL_MS) {
        liveWavePendingFrame = true;
        requestAnimationFrame(() => {
 
            liveWavePendingFrame = false;
            liveWaveLastRender = performance.now();
            liveWaveDraw();
        });
    }
}
 
function liveWaveDrawCanvas(canvas, channels, endTime) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width || 600));
    const height = 235;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const l = 53, r = 16, top = 15, bottom = height - 27;
    const plotWidth = Math.max(1, width - l - r);
    const plotHeight = bottom - top;
    const cutoff = endTime - LIVE_WAVE_WINDOW_MS;
    const visible = liveWaveSamples.filter(s => s.t >= cutoff && s.t <= endTime);
    let minVal = 0, maxVal = 0;
    for (const sample of visible) for (const ch of channels) {
        minVal = Math.min(minVal, sample[ch]);
        maxVal = Math.max(maxVal, sample[ch]);
    }
    const padding = Math.max((maxVal-minVal)*0.12, channels[0].startsWith("A") ? 0.12 : 3);
    minVal -= padding; maxVal += padding;
    // V56: ACC zero-centered scale. A stationary accelerometer can read +/-1 g
    // on an axis due to gravity; do not alter real measurement values.
    // Centering is display-only and lets all three axes share a visible 0 g reference.
    if (channels[0] === "AX") {
        const amplitude = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.25);
        minVal = -amplitude;
        maxVal = amplitude;
    }
    const yAt = v => bottom - (v-minVal)/(maxVal-minVal)*plotHeight;
    const xAt = t => l + (t-cutoff)/LIVE_WAVE_WINDOW_MS*plotWidth;
    ctx.font = "11px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.strokeStyle = "#e2e8f0";
    ctx.fillStyle = "#64748b";
    ctx.lineWidth = 1;
    for(let j=0; j<=4; j++) {
        const frac=j/4, y=top+frac*plotHeight;
        ctx.beginPath(); ctx.moveTo(l,y); ctx.lineTo(width-r,y); ctx.stroke();
        ctx.fillText((maxVal-frac*(maxVal-minVal)).toFixed(channels[0].startsWith("A") ? 1 : 0),l-7,y+4);
    }
    ctx.textAlign="center";
    for(let i=0; i<=4; i++) {
        const x=l+i*plotWidth/4;
        ctx.strokeStyle="#f1f5f9";
        ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,bottom); ctx.stroke();
        ctx.fillStyle="#64748b";
        ctx.fillText((-8+i*2)+" s",x,height-8);
    }
    if (minVal<=0 && maxVal>=0) {
        ctx.strokeStyle="#94a3b8";
        ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(l,yAt(0)); ctx.lineTo(width-r,yAt(0)); ctx.stroke();
        ctx.setLineDash([]);
    }
    const colors=GAZELA_AXIS_COLORS;
    channels.forEach((channel,i)=> {
        ctx.beginPath(); ctx.strokeStyle=colors[i]; ctx.lineWidth=1.8;
        visible.forEach((s,j)=> { const x=xAt(s.t), y=yAt(s[channel]); if(j===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); });
        if (visible.length>1) ctx.stroke();
        if (visible.length) {
            const last=visible[visible.length-1];
            ctx.beginPath();ctx.arc(xAt(last.t),yAt(last[channel]),3.4,0,Math.PI*2);
            ctx.fillStyle=colors[i];ctx.fill();
        }
    });
    if (!visible.length) {
        ctx.textAlign="center";ctx.fillStyle="#94a3b8";ctx.font="13px Arial, sans-serif";
        ctx.fillText("Oczekiwanie na ramki LIVE",l+plotWidth/2,top+plotHeight/2);
    }
}
function liveWaveDraw() {
    if (!liveWaveAccCanvas || !liveWaveGyroCanvas) return;
    const endTime = liveWaveSamples.length ? liveWaveSamples[liveWaveSamples.length-1].t : performance.now();
    liveWaveDrawCanvas(liveWaveAccCanvas,["AX","AY","AZ"],endTime);
    liveWaveDrawCanvas(liveWaveGyroCanvas,["GX","GY","GZ"],endTime);
}
if (liveWavePauseButton) liveWavePauseButton.addEventListener("click",()=>{
    liveWavePaused = !liveWavePaused;
    liveWavePauseButton.textContent = liveWavePaused ? "Wznów wykresy" : "Wstrzymaj wykresy";
    if (liveWaveState) liveWaveState.textContent = liveWavePaused ? "Podgląd wstrzymany" : "Oczekiwanie na LIVE";
});
if (liveWaveClearButton) liveWaveClearButton.addEventListener("click",()=>{
    liveWaveSamples.length=0;
    liveWaveLastSampleMs=null;
    if (liveWaveState) liveWaveState.textContent="Oczekiwanie na LIVE";
 
    liveWaveDraw();
});
window.addEventListener("resize",()=>liveWaveDraw());
liveWaveDraw();
// ========================================================
// END V55 LIVE SENSOR CHARTS
// ========================================================

// ========================================================
// STAGE 8.5 — CONTACT FEEDBACK AUDIO V1
// Browser audio ONLY. Does not intercept LIVE/CAP/BLE or change firmware.
// Future detector bridge: window.GazelaContactFeedback.emitCandidate({eventId, seq})
// Stage 8.6 offline detector calls emitCandidate after verified CAP,DONE.
// ========================================================
(function initGazelaContactAudioV1() {
    "use strict";
    const enableButton = document.getElementById("contactAudioEnable");
    const testButton = document.getElementById("contactAudioTest");
    const status = document.getElementById("contactAudioStatus");
    const last = document.getElementById("contactAudioLast");
    const countElement = document.getElementById("contactAudioCount");
    if (!enableButton || !testButton || !status || !last || !countElement) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const AUDIO_DURATION_S = 0.100;
    const AUDIO_FREQUENCY_HZ = 880;
    const AUDIO_VOLUME = 0.75;
    const MAX_SEEN_IDS = 256;
    let context = null;
    let audioEnabled = false;
    let detectionCount = 0;
    const seenIds = new Set();
    const orderedIds = [];

    function setStatus(message) { status.textContent = message; }
    function setEnabled(enabled) {
        audioEnabled = enabled;
        testButton.disabled = !enabled;
        enableButton.textContent = enabled ? "DISABLE AUDIO" : "ENABLE AUDIO";
        enableButton.setAttribute("aria-pressed", enabled ? "true" : "false");
        enableButton.title = enabled ? "Wyłącz powiadomienia dźwiękowe" : "Włącz powiadomienia dźwiękowe";
    }
    async function unlockAudio() {
        if (!AudioContextClass) {
            setStatus("AUDIO UNSUPPORTED — przeglądarka nie obsługuje Web Audio API.");
            return;
        }
        try {
            if (!context || context.state === "closed") context = new AudioContextClass();
            // resume() must be initiated from user's click to satisfy autoplay policies.
            await context.resume();
            if (context.state !== "running") throw new Error("AudioContext is not running");
            setEnabled(true);
            setStatus("AUDIO READY — automatyczne powiadomienia włączone po analizie CAP,DONE.");
        } catch (error) {
            setEnabled(false);
            setStatus("AUDIO BLOCKED — odblokuj dźwięk w przeglądarce i spróbuj ponownie.");
            console.warn("GAZELA CONTACT AUDIO unlock error:", error);
        }
    }
    function beep() {
        // DISABLE AUDIO is a deliberate mute, not an audio failure.
        if (!audioEnabled) return false;
        if (!context || context.state !== "running") {
            setEnabled(false);
            setStatus("AUDIO BLOCKED / SUSPENDED — kliknij ENABLE AUDIO.");
            return false;
        }
        try {
            const osc = context.createOscillator();
            const gain = context.createGain();
            const t = context.currentTime;
            osc.type = "sine";
            osc.frequency.setValueAtTime(AUDIO_FREQUENCY_HZ, t);
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(AUDIO_VOLUME, t + 0.005);
            gain.gain.setValueAtTime(AUDIO_VOLUME, t + 0.080);
            gain.gain.linearRampToValueAtTime(0, t + AUDIO_DURATION_S);
            osc.connect(gain);
            gain.connect(context.destination);
            osc.start(t);
            osc.stop(t + AUDIO_DURATION_S + 0.005);
            osc.onended = function () { osc.disconnect(); gain.disconnect(); };
            return true;
        } catch (error) {
            setStatus("AUDIO ERROR — odtwarzanie nie powiodło się.");
            console.warn("GAZELA CONTACT AUDIO playback error:", error);
            return false;
        }
    }
    enableButton.addEventListener("click", function () {
        if (audioEnabled) {
            setEnabled(false);
            setStatus("AUDIO DISABLED — detektor nadal analizuje próby, powiadomienia są wyciszone.");
        } else {
            unlockAudio();
        }
    });
    testButton.addEventListener("click", function () {
        if (beep()) setStatus("TEST SOUND OK — test nie jest wykryciem kontaktu.");
    });

    // Stage 8.6 integration: Contact Recorder calls this after CAP,DONE.
    // The detection is experimental and never overrides user BALL/NO BALL labels.
    function emitCandidate(event) {
        if (!event || (typeof event.eventId !== "string" && typeof event.eventId !== "number") ||
            !Number.isSafeInteger(Number(event.seq)) || Number(event.seq) < 0) return false;
        const id = String(event.eventId).trim();
        if (!id || seenIds.has(id)) return false;
        seenIds.add(id);
        orderedIds.push(id);
        if (orderedIds.length > MAX_SEEN_IDS) seenIds.delete(orderedIds.shift());
        detectionCount += 1;
        countElement.textContent = String(detectionCount);
        last.textContent = "LAST CANDIDATE: SEQ " + Number(event.seq) + " | EVENT_ID " + id +
            " | RECEIVED " + new Date().toLocaleTimeString("pl-PL");
        const muted = !audioEnabled;
        const played = beep();
        if (played) setStatus("CONTACT CANDIDATE — sygnał odtworzony (nie potwierdza fizycznego kontaktu).");
        else if (muted) setStatus("CONTACT CANDIDATE — wykryto, AUDIO DISABLED (bez dźwięku).");
        return true;
    }
    Object.defineProperty(window, "GazelaContactFeedback", {
        value: Object.freeze({ emitCandidate: emitCandidate, isAudioReady: function () {
            return !!(audioEnabled && context && context.state === "running");
        } }),
        writable: false,
        configurable: false
    });
    setEnabled(false);
})();
// END STAGE 8.5 CONTACT FEEDBACK AUDIO V1
// ========================================================
// STAGE 8.8 — UI BRIDGE FOR COMPLETED CONTACT TRIALS + CSV IMPORT
// Import is deliberately read-only and separate from Contact Recorder session.
// No BLE requests, no USB requests, no profile writes, no firmware commands.
// ========================================================
(function initGazelaGestureReplayUI() {
    "use strict";
    const ui={
        source:document.getElementById("gestureReplaySource"),
        input:document.getElementById("gestureReplayImport"),
        run:document.getElementById("gestureReplayRun"),
        runAll:document.getElementById("gestureReplayAll"),
        download:document.getElementById("gestureReplayDownload"),
        status:document.getElementById("gestureReplayStatus"),
        metrics:document.getElementById("gestureReplayMetrics"),
        events:document.getElementById("gestureReplayEvents"),
        gestures:document.getElementById("gestureReplayGestures")
    };
    if(!ui.source || !ui.input || !ui.run || !ui.events) return;
    const imported=[];
    let lastDisplayed=null;
    const maxImportFiles=100;
    const csvHeaders=["index","sequence","time_ms","AX_g","AY_g","AZ_g","GX_dps","GY_dps","GZ_dps"];
    function setStatus(message) { if(ui.status)ui.status.textContent=message; }
    function appendRow(cells) {
        const tr=document.createElement("tr");
        for(const val of cells){const td=document.createElement("td");td.textContent=String(val);tr.appendChild(td);}
        ui.events.appendChild(tr);
    }
    function selected() {
        const source=ui.source.value;
        if(source==="current"){
            const trial=contactSelectedTrial();
            return trial ? {name:"Contact Recorder — #"+trial.id,trial,source:"CAP_DONE"}:null;
        }
        return imported.find(item=>item.key===source)||null;
    }
    function runOne(record) {
        if(!record)throw new Error("Nie wybrano zakończonej próby");
        if(record.trial?.integrity!=="PASS") throw new Error("Brak integralności PASS");
        if(record.trial.samples.length!==CONTACT_SAMPLE_COUNT)throw new Error("Wymagane jest 1600 próbek 400 Hz");
        const d=record.trial.detector||gazelaDetectContactOffline(record.trial.samples);
        if(d.error)throw new Error(d.error);
        const replay=gazelaGestureReplayTrial(record.trial.samples,d);
        record.trial.detector=d;
        record.trial.gestureReplay=replay;
        return replay;
    }
    function renderCurrent() {
        const record=selected();
        if(!record){if(ui.download)ui.download.disabled=true;return;}
        const result=record.trial.gestureReplay;
        if(!result){
            if(ui.metrics)ui.metrics.textContent="Brak analizy tej próby.";
            if(ui.gestures)ui.gestures.textContent="Uruchom ANALYZE REPLAY.";
            ui.events.replaceChildren();appendRow(["—","—","—","—","Brak wyników"]);
            if(ui.download)ui.download.disabled=true;
            return;
        }
        lastDisplayed={name:record.name,source:record.source,result,
            trialMetadata:{id:record.trial.id,integrity:record.trial.integrity,
                truth:record.trial.truth||"unreviewed"}};
        if(ui.download)ui.download.disabled=false;
        if(ui.metrics){
            ui.metrics.replaceChildren();
            const entries=["Próbki: "+result.samplesProcessed,
                "SEQ: "+result.integrity,
                "Kandydaci: "+result.events.length,
                "Gesty: "+result.gestures.length,
                "Symulowane ACCEPT: "+result.acceptedCandidateIds.length];
            for(const s of entries){const e=document.createElement("span");e.textContent=s;ui.metrics.appendChild(e);}
        }
        ui.events.replaceChildren();
        for(const e of result.events)appendRow([
            e.eventId,e.timeMs.toFixed(1),e.sequence,
            e.features.preGyro200===null?"—":e.features.preGyro200.toFixed(1),
            e.role.replaceAll("_"," ")
        ]);
        if(!result.events.length)appendRow(["—","—","—","—","Brak kandydatów"]);
        if(ui.gestures){
            ui.gestures.replaceChildren();
            if(!result.gestures.length) {
                const p=document.createElement("div");p.className="gesture-replay-result";
                p.textContent="Brak rozpoznanego DOUBLE TAP w tej próbie.";ui.gestures.appendChild(p);
            }
            for(const g of result.gestures){
                const p=document.createElement("div");
                p.className="gesture-replay-result"+(g.pendingShotId?" recognized":" ");
                p.textContent="DOUBLE TAP " + g.tap1TimeMs.toFixed(1) + " → " +
                    g.tap2TimeMs.toFixed(1) + " ms (Δ="+g.gapMs.toFixed(1)+" ms, GYRO między="+
                    g.betweenGyroDps.toFixed(1)+"°/s). " +
                    (g.pendingShotId?"SIMULATED ACCEPT → "+g.pendingShotId:
                        "GESTURE WITHOUT PRIOR SHOT — brak ACCEPT.");
                ui.gestures.appendChild(p);
            }
        }
        setStatus(record.name+": analiza sekwencyjna gotowa; decyzje nie zmieniają etykiet BALL/NO BALL ani zawartości Arduino.");
    }
    function parseCsv(text,filename) {
        const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(line=>line.trim());
        if(lines.length!==CONTACT_SAMPLE_COUNT+1)throw new Error(filename+": oczekiwano nagłówka i 1600 wierszy");
        const headers=lines[0].split(",").map(s=>s.trim());
        for(const h of csvHeaders)if(!headers.includes(h))throw new Error(filename+": brak kolumny "+h);
        const col=Object.fromEntries(csvHeaders.map(h=>[h,headers.indexOf(h)]));
        const samples=[];
        let firstSeq=null;
        for(let i=1;i<lines.length;i++) {
            const parts=lines[i].split(",");
            const at=h=>{const v=parts[col[h]];return typeof v==="string"&&v.trim()!==""?Number(v):NaN;};
            const index=at("index"), sequence=at("sequence"), time_ms=at("time_ms");
            const s={index,sequence,time_ms,AX:at("AX_g"),AY:at("AY_g"),AZ:at("AZ_g"),
                GX:at("GX_dps"),GY:at("GY_dps"),GZ:at("GZ_dps")};
            if(i===1)firstSeq=sequence;
            if(index!==i-1 || !Number.isSafeInteger(sequence) || sequence<0 || sequence>0xffffffff || sequence!==firstSeq+i-1 ||
                !Number.isFinite(time_ms) || Math.abs(time_ms-(i-1)*2.5)>0.051 ||
                [s.AX,s.AY,s.AZ,s.GX,s.GY,s.GZ].some(v=>!Number.isFinite(v))) {
                throw new Error(filename+": błąd SEQ, indeksu, czasu lub ACC/GYRO w wierszu "+(i+1));
            }
            samples.push(s);
        }
        // Import does not prove BLE CRC / CAP,DONE; only basic CSV and SEQ consistency.
        return {id:filename,type:"import",integrity:"PASS",samples,
            truth:"unreviewed",markers:[],samplePeriodUs:CONTACT_SAMPLE_PERIOD_US,
            importedWithoutCRC:true};
    }
    ui.input.addEventListener("change",async ()=>{
        const files=Array.from(ui.input.files||[]);
        if(files.length>maxImportFiles){setStatus("Limit "+maxImportFiles+" plików CSV na import.");return;}
        let ok=0;
        const errors=[];
        for(const file of files){
            try {
                if(file.size>2_000_000)throw new Error("plik przekracza 2 MB");
                const trial=parseCsv(await file.text(),file.name);
                const key="import-"+(imported.length+1);
                const record={key,name:file.name,trial,source:"CSV_UNVERIFIED_CRC"};
                imported.push(record);
                const option=document.createElement("option");option.value=key;option.textContent="CSV: "+file.name;
                ui.source.appendChild(option);ok++;
            } catch(e){errors.push(file.name+": "+e.message);}
        }
        if(ok)ui.source.value=imported[imported.length-ok].key;
        ui.input.value="";
        setStatus("Wczytano "+ok+" CSV, odrzucono "+errors.length+". "+errors.slice(0,2).join(" | ")+
            ". Import sprawdza SEQ i format, ale nie odtwarza kontroli CRC16 ani CAP,DONE.");
        renderCurrent();
    });
    ui.source.addEventListener("change",renderCurrent);
    ui.run.addEventListener("click",()=>{
        const record=selected();
        if(!record){setStatus("Brak dostępnej próby — nagraj ją albo zaimportuj CSV.");return;}
        try {runOne(record);renderCurrent();}
        catch(error){setStatus("REPLAY ERROR: "+error.message);console.error(error);}
    });
    ui.runAll.addEventListener("click",()=>{
        if(!imported.length){setStatus("Najpierw zaimportuj pliki CSV.");return;}
        let passed=0,gestureCount=0,acceptCount=0;
        const failed=[];
        for(const record of imported){
            try{const r=runOne(record);passed++;gestureCount+=r.gestures.length;acceptCount+=r.acceptedCandidateIds.length;}
            catch(error){failed.push(record.name+": "+error.message);}
        }
        renderCurrent();
        setStatus("BATCH REPLAY: "+passed+"/"+imported.length+" CSV PASS; DOUBLE TAP="+
            gestureCount+", SIMULATED ACCEPT="+acceptCount+". "+failed.slice(0,2).join(" | ")+
            " (wyniki tylko rozwojowe — bez niezależnej walidacji)");
    });
    ui.download?.addEventListener("click",()=>{
        const record=selected();
        if(!record?.trial.gestureReplay)return;
        const data={schema:"gazela.gesture.replay.v1",exportedAt:new Date().toISOString(),
            source:record.source,name:record.name,
            integrityProof:record.source==="CAP_DONE"?"CAP_DONE_CRC_SEQ": "CSV_SEQ_ONLY_NOT_CRC",
            truth:record.trial.truth||"unreviewed",result:record.trial.gestureReplay};
        contactSaveBlob("GAZELA_GESTURE_REPLAY_"+Date.now()+".json",
            new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
    });
    // Called when a Contact Recorder trial is selected / finalized.
    window.GazelaGestureReplayUI=Object.freeze({renderCurrent,parseCsv});
})();
// END STAGE 8.8 UI BRIDGE

// ========================================================
// STAGE 8.9 — GESTURE SIGNATURE LAB / 400 Hz descriptive feature engine
// Manual anchors, no recognizer decisions or training labels used to find them.
// ========================================================
const GAZELA_SIGNATURE_VERSION = "GAZELA_GESTURE_SIGNATURE_V1_DESCRIPTIVE";
const GAZELA_SIGNATURE_WINDOW = Object.freeze({pre:16, post:40, baselineStart:40, baselineEnd:17});
function gazelaSignatureQuantile(values, q) {
    const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
    if(!a.length)return null;
    const p=(a.length-1)*q, i=Math.floor(p);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(p-i);
}
function gazelaSignatureValidate(samples) {
    if(!Array.isArray(samples)||samples.length!==1600)throw new Error("Wymagane 1600 próbek 400 Hz");
    for(let i=0;i<samples.length;i++){
        const s=samples[i];
        if(s.index!==i || !Number.isSafeInteger(s.sequence) || s.sequence<0 || s.sequence>0xffffffff || (i&&s.sequence!==((samples[i-1].sequence+1)>>>0)) || !Number.isFinite(s.time_ms) || Math.abs(s.time_ms-i*2.5)>0.051 || ![s.AX,s.AY,s.AZ,s.GX,s.GY,s.GZ].every(Number.isFinite))throw new Error("Nieprawidłowa próbka / SEQ: "+i);
    }
}
function gazelaSignatureTap(samples,anchor) {
    const w=GAZELA_SIGNATURE_WINDOW;
    if(!Number.isInteger(anchor)||anchor<w.baselineStart||anchor+w.post>=samples.length)throw new Error("Znacznik wymaga 100 ms przed i 100 ms po stuknięciu");
    const axes=["AX","AY","AZ"], gyro=["GX","GY","GZ"];
    const mean=(arr)=>arr.reduce((a,b)=>a+b,0)/arr.length;
    const rms=arr=>Math.sqrt(mean(arr.map(x=>x*x)));
    const baseline=samples.slice(anchor-w.baselineStart,anchor-w.baselineEnd+1);
    const base=axes.map(k=>mean(baseline.map(s=>s[k])));
    const gbase=gyro.map(k=>mean(baseline.map(s=>s[k])));
    const seg=samples.slice(anchor-w.pre,anchor+w.post+1);
    const a=seg.map(s=>axes.map((k,j)=>s[k]-base[j]));
    const g=seg.map(s=>gyro.map((k,j)=>s[k]-gbase[j]));
    const am=a.map(v=>Math.hypot(...v)), gm=g.map(v=>Math.hypot(...v));
    const delta=seg.map((s,j)=>{const prev=samples[anchor-w.pre+j-1];return axes.map(k=>s[k]-prev[k]);});
    const dm=delta.map(v=>Math.hypot(...v));
    const peak=Math.max(...dm), pi=dm.indexOf(peak);
    const dir=peak>0?delta[pi].map(v=>v/peak):[0,0,0];
    const activeThreshold=Math.max(0.05,peak*0.20);
    let lo=pi,hi=pi;while(lo>0&&dm[lo-1]>=activeThreshold)lo--;while(hi<dm.length-1&&dm[hi+1]>=activeThreshold)hi++;
    let e20=0;for(let i=0;i+8<=delta.length;i++){const d=delta.slice(i,i+8);e20=Math.max(e20,d.reduce((sum,v)=>sum+Math.hypot(...v),0)-Math.hypot(...[0,1,2].map(k=>d.reduce((sum,v)=>sum+v[k],0))));}
    const features={accPeakG:Math.max(...am),deltaPeakG:peak,accRmsG:rms(am),gyroChangePeakDps:Math.max(...gm),gyroChangeRmsDps:rms(gm),gyroAbsolutePeakDps:Math.max(...seg.map(s=>Math.hypot(s.GX,s.GY,s.GZ))),e20G:e20,impulseDurationMs:(hi-lo+1)*2.5,tailRmsG:rms(am.slice(w.pre+24)),dirX:dir[0],dirY:dir[1],dirZ:dir[2],axRmsG:rms(a.map(v=>v[0])),ayRmsG:rms(a.map(v=>v[1])),azRmsG:rms(a.map(v=>v[2])),gxRmsDps:rms(g.map(v=>v[0])),gyRmsDps:rms(g.map(v=>v[1])),gzRmsDps:rms(g.map(v=>v[2]))};
    return {anchor,sequence:samples[anchor].sequence,timeMs:samples[anchor].time_ms,features,baselineAcc:base,baselineGyro:gbase,window:{from:anchor-w.pre,to:anchor+w.post},waveform:a.map((v,j)=>({offsetMs:(j-w.pre)*2.5,acc:v,gyro:g[j]}))};
}
function gazelaSignatureDescribe(samples,tap1,tap2) {
    gazelaSignatureValidate(samples);
    if(!Number.isInteger(tap1)||!Number.isInteger(tap2)||tap2-tap1<40)throw new Error("TAP2 musi być co najmniej 100 ms po TAP1; odstępy do 200 ms są oznaczane jako nakładające się okna");
    // Preserve non-overlapping local baseline and feature windows: flag overlap in profile.
    const a=gazelaSignatureTap(samples,tap1), b=gazelaSignatureTap(samples,tap2);
    const between=samples.slice(tap1+16,tap2-15);
    const dot=(x,y)=>x.reduce((sum,v,i)=>sum+v*y[i],0);
    const cos=(x,y)=>{const den=Math.hypot(...x)*Math.hypot(...y);return den>0?Math.max(-1,Math.min(1,dot(x,y)/den)):null;};
    const ratio=a.features.deltaPeakG>0?b.features.deltaPeakG/a.features.deltaPeakG:null;
    return {tap1:a,tap2:b,pair:{gapMs:(tap2-tap1)*2.5,betweenGyroMedianDps:gazelaSignatureQuantile(between.map(s=>Math.hypot(s.GX,s.GY,s.GZ)),.5),deltaPeakRatio:ratio,directionCosine:cos([a.features.dirX,a.features.dirY,a.features.dirZ],[b.features.dirX,b.features.dirY,b.features.dirZ]),accShapeCosine:cos(a.waveform.flatMap(s=>s.acc),b.waveform.flatMap(s=>s.acc)),gyroShapeCosine:cos(a.waveform.flatMap(s=>s.gyro),b.waveform.flatMap(s=>s.gyro))},overlappingWindows:tap2-tap1<=80};
}
function gazelaSignatureBuild(records) {
    const rows=records.filter(r=>r.truth==="gesture"&&r.description&&!r.description.overlappingWindows);
    if(rows.length<5)throw new Error("Minimum 5 potwierdzonych, oznaczonych gestów bez nakładania okien analizy");
    const flat=d=>({...Object.fromEntries(Object.entries(d.tap1.features).map(([k,v])=>["tap1."+k,v])),...Object.fromEntries(Object.entries(d.tap2.features).map(([k,v])=>["tap2."+k,v])),...Object.fromEntries(Object.entries(d.pair).map(([k,v])=>["pair."+k,v]))});
    const vectors=rows.map(r=>flat(r.description));
    const statistics=Object.fromEntries(Object.keys(vectors[0]).map(k=>{const values=vectors.map(v=>v[k]).filter(Number.isFinite);return [k,{n:values.length,min:gazelaSignatureQuantile(values,0),p10:gazelaSignatureQuantile(values,.1),median:gazelaSignatureQuantile(values,.5),p90:gazelaSignatureQuantile(values,.9),max:gazelaSignatureQuantile(values,1)}];}));
    const meanWave=which=>rows[0].description[which].waveform.map((s,i)=>({offsetMs:s.offsetMs,acc:[0,1,2].map(k=>gazelaSignatureQuantile(rows.map(r=>r.description[which].waveform[i].acc[k]),.5)),gyro:[0,1,2].map(k=>gazelaSignatureQuantile(rows.map(r=>r.description[which].waveform[i].gyro[k]),.5))}));
    return {schema:GAZELA_SIGNATURE_VERSION,gesture:"DOUBLE_TAP_ACCEPT",sampleRateHz:400,window:GAZELA_SIGNATURE_WINDOW,recordCount:rows.length,recordIds:rows.map(r=>r.id),captureFingerprints:rows.map(r=>gazelaReferenceFingerprint(r.samples)),statistics,medianWaveforms:{tap1:meanWave("tap1"),tap2:meanWave("tap2")},validated:false,note:"Descriptive statistics only; not thresholds, not firmware configuration."};
}
// END SIGNATURE FEATURE ENGINE

// V60 — device-local reference snapshots only. No session persistence or network sync.
const GAZELA_REFERENCE_SCHEMA = "gazela.gesture.reference.v1";
const GAZELA_REFERENCE_CONFIG = Object.freeze({sampleRateHz:400,accRangeG:16,gyroRangeDps:2000,axes:"GAZELA_AX_AY_AZ_GX_GY_GZ",timeBasis:"nominal_2.5ms",expectedFirmware:"V28.1 HR400",featureSchema:GAZELA_SIGNATURE_VERSION});
const GAZELA_REFERENCE_AXES=["AX","AY","AZ","GX","GY","GZ"];
const referenceFingerprintCache=new WeakMap();
function gazelaReferenceFingerprint(samples){
    if(referenceFingerprintCache.has(samples))return referenceFingerprintCache.get(samples);
    // Non-cryptographic exact-signal fingerprint (not an authentication mechanism).
    // Exclude sequence so re-indexing an identical waveform cannot bypass the guard.
    let a=2166136261,b=0x9e3779b9;
    for(const s of samples){const str=GAZELA_REFERENCE_AXES.map(k=>String(s[k])).join(",")+";";
        for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,2246822519);}}
    const key="sig1:"+(a>>>0).toString(16).padStart(8,"0")+(b>>>0).toString(16).padStart(8,"0");
    referenceFingerprintCache.set(samples,key);return key;
}
function gazelaReferenceClone(value){return JSON.parse(JSON.stringify(value));}
function gazelaReferenceValidateProfile(p){
    if(!p||p.schema!==GAZELA_SIGNATURE_VERSION||p.gesture!=="DOUBLE_TAP_ACCEPT"||p.sampleRateHz!==400||!Object.keys(GAZELA_SIGNATURE_WINDOW).every(k=>p.window?.[k]===GAZELA_SIGNATURE_WINDOW[k])||!Number.isInteger(p.recordCount)||p.recordCount<5||p.recordCount>100)throw new Error("Niezgodny profil HR400 / schema / okno analizy");
    const tapKeys=["accPeakG","deltaPeakG","accRmsG","gyroChangePeakDps","gyroChangeRmsDps","gyroAbsolutePeakDps","e20G","impulseDurationMs","tailRmsG","dirX","dirY","dirZ","axRmsG","ayRmsG","azRmsG","gxRmsDps","gyRmsDps","gzRmsDps"];
    const pairKeys=["gapMs","betweenGyroMedianDps","deltaPeakRatio","directionCosine","accShapeCosine","gyroShapeCosine"];
    const keys=[...['tap1','tap2'].flatMap(t=>tapKeys.map(k=>t+"."+k)),...pairKeys.map(k=>"pair."+k)];
    const statistics={};
    for(const k of keys){const v=p.statistics?.[k];if(!v||!Number.isInteger(v.n)||v.n<0||v.n>p.recordCount)throw new Error("Nieprawidłowa statystyka: "+k);
        const vals=[v.min,v.p10,v.median,v.p90,v.max];
        if(v.n===0?!vals.every(x=>x===null):!vals.every((x,i)=>Number.isFinite(x)&&Math.abs(x)<=1e9&&(!i||x>=vals[i-1])))throw new Error("Nieprawidłowa statystyka: "+k);
        statistics[k]={n:v.n,min:v.min,p10:v.p10,median:v.median,p90:v.p90,max:v.max};}
    if(statistics['pair.gapMs'].min<=200||statistics['pair.gapMs'].max>4000)throw new Error("Nieprawidłowy odstęp TAP1–TAP2 w profilu");
    const medianWaveforms={};for(const t of ['tap1','tap2']){const w=p.medianWaveforms?.[t];if(!Array.isArray(w)||w.length!==57)throw new Error("Wymagane 57 próbek każdego przebiegu");
        medianWaveforms[t]=w.map((s,i)=>{if(!s||s.offsetMs!==(i-16)*2.5||![s.acc,s.gyro].every(a=>Array.isArray(a)&&a.length===3&&a.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e6)))throw new Error("Nieprawidłowy przebieg "+t+" / "+i);return {offsetMs:s.offsetMs,acc:s.acc.slice(),gyro:s.gyro.slice()};});}
    const recordIds=Array.isArray(p.recordIds)?p.recordIds.filter(x=>typeof x==="string").slice(0,100).map(x=>x.slice(0,120)):[];
    const fingerprints=Array.isArray(p.captureFingerprints)?p.captureFingerprints.filter(x=>typeof x==="string"&&/^sig1:[0-9a-f]{16}$/.test(x)):[];
    return {schema:GAZELA_SIGNATURE_VERSION,gesture:"DOUBLE_TAP_ACCEPT",sampleRateHz:400,window:{...GAZELA_SIGNATURE_WINDOW},recordCount:p.recordCount,recordIds,statistics,medianWaveforms,captureFingerprints:fingerprints.length===p.recordCount?fingerprints:[],validated:false,note:"Descriptive statistics only; not thresholds, not firmware configuration."};
}
function gazelaReferenceMakeId(){return "REF-"+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+"-"+Math.random().toString(36).slice(2));}
function gazelaReferenceNormalize(raw){
    if(!raw||raw.schema!==GAZELA_REFERENCE_SCHEMA||!['single','profile'].includes(raw.type))throw new Error("Nieobsługiwany format wzorca");
    if(!Object.keys(GAZELA_REFERENCE_CONFIG).every(k=>raw.config?.[k]===GAZELA_REFERENCE_CONFIG[k]))throw new Error("Wzorzec ma niezgodną konfigurację HR400");
    if(typeof raw.id!=="string"||!/^REF-[a-zA-Z0-9-]{1,100}$/.test(raw.id))throw new Error("Nieprawidłowy identyfikator wzorca");
    if(typeof raw.name!=="string"||!raw.name.trim()||raw.name.length>100)throw new Error("Nazwa wzorca: 1–100 znaków");
    if(typeof raw.createdAt!=="string"||!Number.isFinite(Date.parse(raw.createdAt)))throw new Error("Nieprawidłowa data wzorca");
    const common={schema:GAZELA_REFERENCE_SCHEMA,id:raw.id,name:raw.name.trim(),createdAt:raw.createdAt,type:raw.type,config:{...GAZELA_REFERENCE_CONFIG},validated:false};
    if(raw.type==="profile")return {...common,profile:gazelaReferenceValidateProfile(raw.profile)};
    const r=raw.record;
    if(!r||r.truth!=="gesture"||!Array.isArray(r.anchors)||r.anchors.length!==2)throw new Error("Wymagany ręcznie potwierdzony gest z dwoma znacznikami");
    gazelaSignatureValidate(r.samples);
    const samples=r.samples.map(s=>({index:s.index,sequence:s.sequence,time_ms:s.time_ms,...Object.fromEntries(GAZELA_REFERENCE_AXES.map(k=>[k,s[k]]))}));
    if(samples.some(s=>GAZELA_REFERENCE_AXES.some(k=>Math.abs(s[k])>1e6)))throw new Error("Nieprawidłowy zakres danych próbki");
    const description=gazelaSignatureDescribe(samples,...r.anchors);
    if(description.overlappingWindows)throw new Error("Nakładające się okna analizy");
    return {...common,record:{id:common.id,name:common.name,truth:"gesture",kind:"double_tap",anchors:r.anchors.slice(),samples,description,proof:typeof r.proof==="string"?r.proof.slice(0,100):"IMPORTED_REFERENCE",capturedAt:typeof r.capturedAt==="string"?r.capturedAt.slice(0,50):null},captureFingerprint:gazelaReferenceFingerprint(samples)};
}
function gazelaReferenceOpen(){
    return new Promise((resolve,reject)=>{
        if(!globalThis.indexedDB){reject(new Error("IndexedDB niedostępna"));return;}
        const req=indexedDB.open("gazela-gesture-references",1);
        req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("references"))req.result.createObjectStore("references",{keyPath:"id"});};
        req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(db);};
        req.onerror=()=>reject(req.error||new Error("Nie można otworzyć bazy"));
        req.onblocked=()=>reject(new Error("Baza zablokowana przez inną kartę"));
    });
}
function gazelaReferenceTransaction(db,mode,action){
    return new Promise((resolve,reject)=>{const tx=db.transaction("references",mode);let result;const req=action(tx.objectStore("references"));req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||req.error||new Error("Operacja lokalnej bazy nie powiodła się"));});
}


// STAGE 8.9 — UI and separate gesture library; shared capture engine.
(function initGazelaSignatureLab(){
    "use strict";
    const get=id=>document.getElementById("gsl"+id);
    const ui=Object.fromEntries(["Kind","Record","Cancel","FromContact","Import","Status","Counts","Trial","Truth","AnchorMode","Tap1","Tap2","Suggest","ClearAnchors","Candidates","Acc","Gyro","FeaturesStatus","Features","Build","Export","Profile","ProfileStatus","ProfileTable","WaveMode","WaveAcc","WaveGyro"].map(id=>[id,get(id)]));
    if(!ui.Record)return;
    const records=[];let selectedId=null,profile=null,serial=0, importing=false;
    const maxRecords=100;
    const cu=Object.fromEntries(["Reference","ReferenceInfo","Record","Cancel","Import","FromContact","Clear","Status","AnchorMode","Tap1","Tap2","Suggest","Candidates","Acc","Gyro","Compare","Export","Overall","Metrics","Explanation","WaveMode","WaveAcc","WaveGyro","Features"].map(id=>[id,document.getElementById("gc"+id)]));
    let comparatorTest=null, comparatorResult=null, comparatorImporting=false, comparatorRefKey="";
    const ru=Object.fromEntries(["Name","SaveSingle","SaveProfile","Select","Use","Export","Import","Delete","Info","Status"].map(id=>[id,document.getElementById("grl"+id)]));
    const savedReferences=new Map();let referenceDb=null,referenceBusy=true,referenceReady=false,referenceListKey="";
    const kinds={double_tap:"DOUBLE TAP",single_tap:"SINGLE TAP",ball:"BALL",double_ball:"DOUBLE BALL",movement:"MOVEMENT",other:"OTHER"};
    const selected=()=>records.find(r=>r.id===selectedId)||null;
    const status=s=>{ui.Status.textContent=s;};
    const fmt=x=>Number.isFinite(x)?Number(x.toFixed(3)).toString():"—";
    function row(target,values){const tr=document.createElement("tr");for(const val of values){const td=document.createElement("td");td.textContent=String(val);tr.appendChild(td);}target.appendChild(tr);}
    function invalidate(){clearComparison();profile=null;ui.WaveMode.value="trial";ui.ProfileTable.replaceChildren();ui.ProfileStatus.textContent="Profil nieaktualny — zbuduj ponownie. Minimum 5 potwierdzonych gestów z osobnymi oknami (zalecane 20).";}
    function updateControls(){
        const busy=contactIsBusy(),r=selected(),own=busy&&contactCapture.purpose==="gesture";
        ui.Record.disabled=busy||measuring||!contactTransportReady()||records.length>=maxRecords||importing;
        ui.Cancel.disabled=!own||contactCapture.state==="finalizing";
        ui.Kind.disabled=busy||importing;
        ui.FromContact.disabled=busy||!contactSelectedTrial()||records.length>=maxRecords||importing;
        ui.Import.disabled=busy||records.length>=maxRecords||importing;
        ui.Trial.disabled=!records.length||busy||importing;
        for(const element of [ui.Truth,ui.Tap1,ui.Tap2,ui.Suggest,ui.ClearAnchors,ui.AnchorMode])element.disabled=!r||busy||importing;
        const good=records.filter(r=>r.truth==="gesture"&&r.description&&!r.description.overlappingWindows).length;
        ui.Build.disabled=busy||importing||good<5;
        ui.Export.disabled=busy||importing||!records.length;
        ui.Profile.disabled=busy||importing||!profile;
        ui.WaveMode.options[1].disabled=!profile;
        comparatorRefresh();
        referenceRefresh();
        ui.Counts.textContent=`Nagrania: ${records.length} / ${maxRecords} • Gesty potwierdzone i gotowe do profilu: ${good} • Kontrole: ${records.filter(r=>r.truth==="negative").length} • Nieocenione: ${records.filter(r=>r.truth==="unreviewed").length}`;
    }
    function describe(r){
        r.description=null;r.tapFeatures=[null,null];r.error=null;
        try{
            // Independent single-tap features are also available for negative controls.
            for(let j=0;j<2;j++)if(r.anchors[j]!==null){try{r.tapFeatures[j]=gazelaSignatureTap(r.samples,r.anchors[j]);}catch(e){r.error=e.message;}}
            if(r.anchors.every(Number.isInteger))r.description=gazelaSignatureDescribe(r.samples,...r.anchors);
        }catch(e){r.error=e.message;}
    }
    function plot(canvas,channels,r){
        const w=Math.max(200,Math.round(canvas.getBoundingClientRect().width||450)),h=190,dpr=window.devicePixelRatio||1;
        canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext("2d");if(!c)return;c.scale(dpr,dpr);
        const left=42,right=w-12,top=18,bottom=h-24;
        canvas._gslGeometry={left,right,width:w};
        c.clearRect(0,0,w,h);c.font="10px Arial";c.fillStyle="#64748b";
        if(!r){c.fillText("Brak danych 400 Hz",left,60);return;}
        const vals=channels.flatMap(k=>r.samples.map(s=>s[k]));let min=Math.min(...vals),max=Math.max(...vals);if(max-min<1e-6){min-=1;max+=1;}
        const x=i=>left+(right-left)*i/1599, y=v=>bottom-(v-min)/(max-min)*(bottom-top);
        for(let j=0;j<=4;j++){const yy=top+(bottom-top)*j/4;c.strokeStyle="#e2e8f0";c.beginPath();c.moveTo(left,yy);c.lineTo(right,yy);c.stroke();c.fillStyle="#64748b";c.fillText(fmt(max-(max-min)*j/4),2,yy+3);}
        channels.forEach((k,j)=>{c.strokeStyle=["#dc2626","#2563eb","#16a34a"][j];c.lineWidth=1;c.beginPath();r.samples.forEach((s,i)=>i?c.lineTo(x(i),y(s[k])):c.moveTo(x(i),y(s[k])));c.stroke();c.fillStyle=c.strokeStyle;c.fillText(k,left+j*28,h-3);});
        for(const cand of r.candidates){c.strokeStyle="#a78bfa";c.setLineDash([3,3]);c.beginPath();c.moveTo(x(cand.index),top);c.lineTo(x(cand.index),bottom);c.stroke();}c.setLineDash([]);
        r.anchors.forEach((i,j)=>{if(i===null)return;c.strokeStyle=j?"#059669":"#d97706";c.lineWidth=2;c.beginPath();c.moveTo(x(i),top);c.lineTo(x(i),bottom);c.stroke();c.fillStyle=c.strokeStyle;c.fillText("T"+(j+1),Math.min(right-14,x(i)+2),12);});
        c.fillStyle="#64748b";c.fillText("0 s",left,bottom+12);c.fillText("4 s",right-15,bottom+12);
    }
    function plotAligned(canvas,key,series){
        const w=Math.max(200,Math.round(canvas.getBoundingClientRect().width||450)),h=190,dpr=window.devicePixelRatio||1;
        canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext("2d");if(!c)return;c.scale(dpr,dpr);
        const left=44,right=w-12,top=16,bottom=h-24;
        c.font="10px Arial";c.fillStyle="#64748b";
        const values=series.filter(Boolean).flatMap(t=>t.flatMap(s=>s[key]));
        if(!values.length){c.fillText("Wskaż impuls",left,55);return;}
        const extent=Math.max(.001,...values.map(Math.abs)),x=ms=>left+(ms+40)/140*(right-left),y=v=>(top+bottom)/2-v/extent*(bottom-top)/2;
        for(const v of [-extent,-extent/2,0,extent/2,extent]){c.strokeStyle="#e2e8f0";c.beginPath();c.moveTo(left,y(v));c.lineTo(right,y(v));c.stroke();c.fillStyle="#64748b";c.fillText(fmt(v),1,y(v)+3);}
        c.strokeStyle="#94a3b8";c.setLineDash([2,3]);c.beginPath();c.moveTo(x(0),top);c.lineTo(x(0),bottom);c.stroke();c.setLineDash([]);
        series.forEach((t,j)=>{if(!t)return;c.setLineDash(j?[4,3]:[]);for(let k=0;k<3;k++){c.strokeStyle=["#dc2626","#2563eb","#16a34a"][k];c.lineWidth=1.5;c.beginPath();t.forEach((s,i)=>i?c.lineTo(x(s.offsetMs),y(s[key][k])):c.moveTo(x(s.offsetMs),y(s[key][k])));c.stroke();}});c.setLineDash([]);
        c.fillStyle="#64748b";c.fillText("−40 ms",left,bottom+13);c.fillText("0",x(0),bottom+13);c.fillText("100 ms",right-39,bottom+13);
    }
    function renderWaves(){
        const r=selected(),useProfile=ui.WaveMode.value==="profile"&&profile;
        const series=useProfile?[profile.medianWaveforms.tap1,profile.medianWaveforms.tap2]:(r?.tapFeatures||[]).map(t=>t?.waveform||null);
        plotAligned(ui.WaveAcc,"acc",series);plotAligned(ui.WaveGyro,"gyro",series);
    }
    function renderFeatures(r){
        ui.Features.replaceChildren();
        if(!r){ui.FeaturesStatus.textContent="Wskaż oba stuknięcia, aby obliczyć cechy.";return;}
        const a=r.tapFeatures[0]?.features||{},b=r.tapFeatures[1]?.features||{};
        for(const k of new Set([...Object.keys(a),...Object.keys(b)]))row(ui.Features,[k,fmt(a[k]),fmt(b[k])]);
        if(r.description){for(const [k,v] of Object.entries(r.description.pair))row(ui.Features,["PAIR • "+k,fmt(v),"—"]);}
        ui.FeaturesStatus.textContent=r.error?"Uwaga: "+r.error:r.description?`Odstęp: ${fmt(r.description.pair.gapMs)} ms. `+(r.description.overlappingWindows?"Okna analizy / bazowe nakładają się; nie używamy tej pary w profilu.":"Cechy obliczone z ręcznych znaczników."):"Wskaż oba stuknięcia; pojedynczy znacznik pozwala zbadać pojedynczy impuls kontrolny.";
    }
    function render(){
        const r=selected();ui.Trial.replaceChildren();
        if(!records.length){const o=document.createElement("option");o.value="";o.textContent="Brak nagrań";ui.Trial.appendChild(o);}
        for(const item of records){const o=document.createElement("option");o.value=item.id;o.textContent=item.id+" • "+kinds[item.kind]+" • "+item.name+" • "+item.truth;ui.Trial.appendChild(o);}
        ui.Trial.value=selectedId||"";ui.Truth.value=r?.truth||"unreviewed";
        ui.Tap1.value=r?.anchors[0]??"";ui.Tap2.value=r?.anchors[1]??"";
        ui.Candidates.textContent="Kandydaci (indeksy): "+(r?.candidates.map(c=>c.index+" / "+fmt(c.timeMs)+" ms").join("; ")||"—");
        plot(ui.Acc,["AX","AY","AZ"],r);plot(ui.Gyro,["GX","GY","GZ"],r);renderFeatures(r);renderWaves();updateControls();renderComparatorPlots();
    }
    function addTrial(trial,kind,name,proof){
        if(records.length>=maxRecords)throw new Error("Limit 100 nagrań laboratorium");
        gazelaSignatureValidate(trial.samples);
        const samples=trial.samples.map(s=>({...s}));
        // Reject duplicate raw capture irrespective of the name or label.
        if(records.some(r=>r.samples[0].sequence===samples[0].sequence&&r.samples.every((s,i)=>["AX","AY","AZ","GX","GY","GZ"].every(k=>s[k]===samples[i][k]))))throw new Error("Ta próba jest już w bibliotece");
        const d=gazelaDetectContactOffline(samples);
        const record={id:"GSL-"+String(++serial).padStart(3,"0"),kind,name,proof,truth:"unreviewed",anchors:[null,null],samples,candidates:d.candidates||[],description:null,tapFeatures:[null,null],capturedAt:trial.capturedAt||null,addedAt:new Date().toISOString()};
        records.push(record);selectedId=record.id;invalidate();render();return record;
    }
    function commit(trial,kind){
        try{const record=addTrial(trial,kind,"BLE — "+(trial.completedAt||""),"CAP_DONE_CRC16_SEQ");status(record.id+": zapis 1600/1600, CRC16 + SEQ + CAP,DONE PASS. Wskaż TAP1 / TAP2 i oceń wykonanie.");}
        catch(e){status("Błąd biblioteki: "+e.message);throw e;}
    }
    function setAnchor(j,value){const r=selected();if(!r||contactIsBusy())return;
        if(value!==null&&(!Number.isInteger(value)||value<0||value>1599)){status("Indeks musi być liczbą całkowitą 0–1599.");render();return;}
        r.anchors[j]=value;describe(r);invalidate();render();}
    ui.Record.addEventListener("click",()=>contactStart("gesture",ui.Kind.value));
    ui.Cancel.addEventListener("click",()=>contactCancel());
    ui.FromContact.addEventListener("click",()=>{const t=contactSelectedTrial();if(!t||!t.transportFinalized)return;try{const r=addTrial(t,ui.Kind.value,"Contact #"+t.id,"CAP_DONE_CRC16_SEQ");status(r.id+": skopiowano próbę bez zmiany etykiet Contact Recorder.");}catch(e){status(e.message);}});
    ui.Import.addEventListener("change",async()=>{
        const files=Array.from(ui.Import.files||[]),kind=ui.Kind.value;let ok=0;const errors=[];importing=true;updateControls();
        try{for(const file of files){if(records.length>=maxRecords){errors.push("Limit biblioteki");break;}try{if(file.size>2000000)throw new Error("Limit 2 MB/CSV");const t=window.GazelaGestureReplayUI.parseCsv(await file.text(),file.name);addTrial(t,kind,file.name,"CSV_SEQ_ONLY_NOT_CRC");ok++;}catch(e){errors.push(file.name+": "+e.message);}}status("Import: "+ok+" poprawnych, "+errors.length+" błędów. "+errors.slice(0,3).join(" | "));}finally{importing=false;ui.Import.value="";updateControls();}
    });
    ui.Trial.addEventListener("change",()=>{selectedId=ui.Trial.value;render();});
    ui.Truth.addEventListener("change",()=>{const r=selected();if(r){r.truth=ui.Truth.value;invalidate();render();}});
    [ui.Tap1,ui.Tap2].forEach((el,j)=>el.addEventListener("change",()=>setAnchor(j,el.value.trim()===""?null:Number(el.value))));
    [ui.Acc,ui.Gyro].forEach(canvas=>canvas.addEventListener("click",e=>{if(!selected()||contactIsBusy())return;const g=canvas._gslGeometry,rect=canvas.getBoundingClientRect();if(!g||!rect.width)return;const pos=(e.clientX-rect.left)*g.width/rect.width;if(pos<g.left||pos>g.right)return;setAnchor(Number(ui.AnchorMode.value)-1,Math.round((pos-g.left)/(g.right-g.left)*1599));}));
    ui.Suggest.addEventListener("click",()=>{const r=selected();if(!r)return;if(r.candidates.length===2){r.anchors=r.candidates.map(c=>c.index);describe(r);invalidate();render();status("Podstawiono 2 kandydatów. Zweryfikuj znaczniki i potwierdź wykonanie ręcznie.");}else status("Sugestia automatyczna wymaga dokładnie dwóch kandydatów. Wskaż ręcznie TAP1/TAP2 na wykresie lub wpisz ich indeksy ("+r.candidates.length+" kandydatów)." );});
    ui.ClearAnchors.addEventListener("click",()=>{const r=selected();if(r){r.anchors=[null,null];describe(r);invalidate();render();}});
    ui.WaveMode.addEventListener("change",renderWaves);
    ui.Build.addEventListener("click",()=>{try{profile=gazelaSignatureBuild(records);ui.ProfileTable.replaceChildren();for(const [k,v] of Object.entries(profile.statistics))row(ui.ProfileTable,[k,v.n,fmt(v.median),fmt(v.p10)+" – "+fmt(v.p90),fmt(v.min)+" – "+fmt(v.max)]);ui.ProfileStatus.textContent=`GESTURE SIGNATURE V1: ${profile.recordCount} ręcznie potwierdzonych nagrań. Statystyki opisowe i mediany przebiegów sześciu osi. Profil jeszcze NIE jest klasyfikatorem. Kontrole w ZIP: ${records.filter(r=>r.truth==="negative").length}.`;ui.WaveMode.value="profile";clearComparison();renderWaves();updateControls();renderComparatorPlots();}catch(e){status(e.message);}});
    ui.Profile.addEventListener("click",()=>{if(profile)contactSaveBlob("GAZELA_GESTURE_SIGNATURE_V1.json",new Blob([JSON.stringify(profile,null,2)],{type:"application/json"}));});
    ui.Export.addEventListener("click",()=>{try{
        const files=[];
        for(const r of records){const rows=[["index","sequence","time_ms","AX_g","AY_g","AZ_g","GX_dps","GY_dps","GZ_dps"]];for(const s of r.samples)rows.push([s.index,s.sequence,s.time_ms,s.AX,s.AY,s.AZ,s.GX,s.GY,s.GZ]);files.push([r.id+".csv",contactCSV(rows)]);}
        const manifest={schema:"gazela.gesture.lab.v1",exportedAt:new Date().toISOString(),sampleRateHz:400,window:GAZELA_SIGNATURE_WINDOW,records:records.map(({samples,...r})=>r),profile};
        files.push(["gesture_lab.json",JSON.stringify(manifest,null,2)]);if(profile)files.push(["gesture_signature_v1.json",JSON.stringify(profile,null,2)]);
        contactSaveBlob("GAZELA_GESTURE_LAB_"+Date.now()+".zip",contactBuildZip(files));status("Eksport ZIP gotowy: surowe CSV, ręczne oceny, cechy i aktualny profil (jeśli zbudowany).");
    }catch(e){status("Eksport: "+e.message);}});
    // V59: independent HR400 comparator. The same capture engine routes CAP,DONE here.
    const cmpAxes=["AX","AY","AZ","GX","GY","GZ"];
    const cmpKeys=["accPeakG","deltaPeakG","accRmsG","gyroChangePeakDps","gyroChangeRmsDps","impulseDurationMs","dirX","dirY","dirZ"];
    const cmpPairKeys=["gapMs","betweenGyroMedianDps","deltaPeakRatio","directionCosine","accShapeCosine","gyroShapeCosine"];
    const comparatorStatus=s=>{cu.Status.textContent=s;};
    function referenceChoices(){
        const choices=records.filter(r=>r.truth==="gesture"&&r.description&&!r.description.overlappingWindows).map(r=>({id:r.id,label:r.id+" • "+r.name,record:r}));
        if(profile)choices.unshift({id:"profile",label:`PROFILE • ${profile.recordCount} gestów`,profile});
        return [...Array.from(savedReferences.values(),r=>({...r,label:"LOCAL • "+r.name+" • "+(r.type==="single"?"GESTURE":r.profile.recordCount+" gestów")})),...choices];
    }
    function currentReference(){return referenceChoices().find(r=>r.id===cu.Reference.value)||null;}
    function referenceDescription(ref){
        if(!ref)return null;
        if(ref.record)return ref.record.description;
        const med=ref.profile.statistics;
        const tap=which=>({features:Object.fromEntries(Object.keys(med).filter(k=>k.startsWith(which+".")).map(k=>[k.slice(which.length+1),med[k].median])),waveform:ref.profile.medianWaveforms[which]});
        return {tap1:tap("tap1"),tap2:tap("tap2"),pair:Object.fromEntries(Object.keys(med).filter(k=>k.startsWith("pair.")).map(k=>[k.slice(5),med[k].median]))};
    }
    function sameCapture(a,b){return a.samples[0].sequence===b.samples[0].sequence&&a.samples.every((s,i)=>cmpAxes.every(k=>s[k]===b.samples[i][k]));}
    function isTrainingCapture(ref){
        if(!ref||!comparatorTest)return false;
        if(ref.record)return gazelaReferenceFingerprint(ref.record.samples)===gazelaReferenceFingerprint(comparatorTest.samples);
        const fp=gazelaReferenceFingerprint(comparatorTest.samples);
        if(ref.profile.captureFingerprints?.includes(fp))return true;
        // Session IDs are reused on reload: do not use them to match imported profiles.
        return ref.id==="profile"&&records.some(r=>ref.profile.recordIds.includes(r.id)&&sameCapture(r,comparatorTest));
    }
    function clearComparison(){
        comparatorResult=null;
        cu.Overall.textContent="—";cu.Metrics.replaceChildren();cu.Features.replaceChildren();
        cu.Explanation.textContent="Wskaż dwa impulsy testowe i wybierz wzorzec. Wynik nie jest prawdopodobieństwem rozpoznania.";
    }
    function comparatorRefresh(){
        const opts=referenceChoices(), key=JSON.stringify(opts.map(o=>[o.id,o.label]));
        if(key!==comparatorRefKey){
            const prior=cu.Reference.value;cu.Reference.replaceChildren();
            const empty=document.createElement("option");empty.value="";empty.textContent=opts.length?"Wybierz wzorzec":"Brak wzorca";cu.Reference.appendChild(empty);
            for(const opt of opts){const o=document.createElement("option");o.value=opt.id;o.textContent=opt.label;cu.Reference.appendChild(o);}
            cu.Reference.value=opts.some(o=>o.id===prior)?prior:"";if(prior&&!cu.Reference.value)clearComparison();comparatorRefKey=key;
        }
        const ref=currentReference(), busy=contactIsBusy(), own=busy&&contactCapture.purpose==="comparator";
        const locked=busy||comparatorImporting||importing;
        cu.Reference.disabled=locked||!opts.length;
        cu.ReferenceInfo.textContent=ref?(ref.record?`Wzorzec: ${ref.record.id}, ręcznie potwierdzony gest.`:`Profil: ${ref.profile.recordCount} potwierdzonych gestów, mediany; niewalidowany.`):"Wybierz potwierdzone nagranie lub zbuduj profil w Learning.";
        if(ref?.schema===GAZELA_REFERENCE_SCHEMA)cu.ReferenceInfo.textContent="LOCAL • "+ref.name+" • "+ref.createdAt.slice(0,10)+". "+cu.ReferenceInfo.textContent;
        if(ref?.profile&&!ref.profile.captureFingerprints?.length)cu.ReferenceInfo.textContent+=" Import starszego profilu bez identyfikatorów sygnałów: samodzielnie zapewnij niezależność testu.";
        cu.Record.disabled=locked||measuring||!contactTransportReady();
        cu.Cancel.disabled=!own||contactCapture.state==="finalizing";
        cu.Import.disabled=locked;
        cu.FromContact.disabled=locked||!contactSelectedTrial()?.transportFinalized;
        cu.Clear.disabled=locked||!comparatorTest;
        for(const el of [cu.AnchorMode,cu.Tap1,cu.Tap2,cu.Suggest])el.disabled=locked||!comparatorTest;
        cu.Compare.disabled=locked||!ref||!comparatorTest?.description||comparatorTest.description.overlappingWindows||isTrainingCapture(ref);
        cu.Export.disabled=locked||!comparatorTest;
        if(ref&&isTrainingCapture(ref))cu.ReferenceInfo.textContent+=" Test jest częścią tego wzorca — porównanie zablokowane.";
    }
    function renderComparatorPlots(){
        const r=comparatorTest;plot(cu.Acc,["AX","AY","AZ"],r);plot(cu.Gyro,["GX","GY","GZ"],r);
        const which=cu.WaveMode.value, j=which==="tap1"?0:1;
        const waves=[referenceDescription(currentReference())?.[which]?.waveform||null,r?.tapFeatures[j]?.waveform||null];
        plotAligned(cu.WaveAcc,"acc",waves);plotAligned(cu.WaveGyro,"gyro",waves);
    }
    function renderComparator(){
        const r=comparatorTest;cu.Tap1.value=r?.anchors[0]??"";cu.Tap2.value=r?.anchors[1]??"";
        cu.Candidates.textContent="Kandydaci (indeksy): "+(r?.candidates.map(c=>c.index+" / "+fmt(c.timeMs)+" ms").join("; ")||"—");
        comparatorRefresh();renderComparatorPlots();
    }
    function loadComparatorTrial(trial,name,proof){
        gazelaSignatureValidate(trial.samples);
        const samples=trial.samples.map(s=>({...s})),d=gazelaDetectContactOffline(samples);
        comparatorTest={name,proof,kind:"double_tap",samples,anchors:[null,null],tapFeatures:[null,null],candidates:d.candidates||[],description:null,capturedAt:trial.capturedAt||null};
        clearComparison();renderComparator();comparatorStatus(name+" • 1600/1600 • "+proof+". Wskaż TAP1 i TAP2.");
    }
    function commitComparator(trial){
        try{loadComparatorTrial(trial,"BLE — "+trial.completedAt,"CAP_DONE_CRC16_SEQ");}
        catch(e){comparatorStatus("Błąd testu: "+e.message);throw e;}
    }
    function setComparatorAnchor(j,value){
        if(!comparatorTest||contactIsBusy()||comparatorImporting||importing)return;
        if(value!==null&&(!Number.isInteger(value)||value<0||value>1599)){comparatorStatus("Indeks 0–1599 (liczba całkowita).");renderComparator();return;}
        comparatorTest.anchors[j]=value;describe(comparatorTest);clearComparison();renderComparator();
        comparatorStatus(comparatorTest.error|| (comparatorTest.description?.overlappingWindows?"Nakładające się okna — porównanie wyłączone.":comparatorTest.description?"Dwa znaczniki ustawione. Zweryfikuj ich położenie, potem COMPARE.":"Wskaż oba impulsy testowe."));
    }
    // Scores are descriptive, not calibrated probabilities. No time warping or axis normalization.
    const validMean=values=>{const good=values.filter(Number.isFinite);return good.length?good.reduce((a,b)=>a+b,0)/good.length:null;};
    function positiveRatio(a,b){if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0||Math.max(a,b)===0)return null;return 100*Math.min(a,b)/Math.max(a,b);}
    function similarityCos(a,b){
        if(a.length!==b.length||!a.length||!a.every(Number.isFinite)||!b.every(Number.isFinite))return null;
        const den=Math.hypot(...a)*Math.hypot(...b);return den>0?100*Math.max(0,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)/den)):null;
    }
    function cosineFeature(a,b){return Number.isFinite(a)&&Number.isFinite(b)?100*Math.max(0,1-Math.abs(a-b)/2):null;}
    function compareDescriptions(ref,test){
        const taps=["tap1","tap2"];
        const shape=key=>validMean(taps.map(t=>similarityCos(ref[t].waveform.flatMap(s=>s[key]),test[t].waveform.flatMap(s=>s[key]))));
        const amplitude=validMean(taps.flatMap(t=>["accPeakG","deltaPeakG","accRmsG","gyroChangePeakDps","gyroChangeRmsDps"].map(k=>positiveRatio(ref[t].features[k],test[t].features[k]))));
        const timing=validMean([positiveRatio(ref.pair.gapMs,test.pair.gapMs),...taps.map(t=>positiveRatio(ref[t].features.impulseDurationMs,test[t].features.impulseDurationMs))]);
        // Pair structure: ratio of impulse peaks, direction cosine and within-pair shapes.
        const structure=validMean([positiveRatio(ref.pair.deltaPeakRatio,test.pair.deltaPeakRatio),...['directionCosine','accShapeCosine','gyroShapeCosine'].map(k=>cosineFeature(ref.pair[k],test.pair[k]))]);
        const metrics={accShape:shape("acc"),gyroShape:shape("gyro"),amplitude,timing,structure};
        const vals=Object.values(metrics);return {metrics,overall:vals.every(Number.isFinite)?validMean(vals):null};
    }
    function runComparison(){
        const ref=currentReference(),test=comparatorTest?.description;
        if(contactIsBusy()||!ref||!test||test.overlappingWindows||isTrainingCapture(ref))return;
        clearComparison();const rd=referenceDescription(ref), scores=compareDescriptions(rd,test);
        const labels={accShape:"ACC — kształt",gyroShape:"GYRO — kształt",amplitude:"Amplituda impulsów",timing:"Czas i odstęp",structure:"Struktura gestu"};
        comparatorResult={schema:"gazela.gesture.comparator.v1.experimental",referenceId:ref.id,referenceName:ref.name||ref.label,referenceType:ref.record?"single":"profile",referenceCreatedAt:ref.createdAt||null,referenceConfig:ref.config||GAZELA_REFERENCE_CONFIG,reference:rd,testDescription:test,metrics:scores.metrics,overall:scores.overall,validated:false};
        cu.Overall.textContent=Number.isFinite(scores.overall)?scores.overall.toFixed(1)+"%":"—";
        for(const [k,v] of Object.entries(scores.metrics)){
            const item=document.createElement("div");item.className="gc-metric";
            const lab=document.createElement("div");lab.className="gc-metric-label";const a=document.createElement("span"),b=document.createElement("span");a.textContent=labels[k];b.textContent=Number.isFinite(v)?v.toFixed(1)+"%":"N/D";lab.append(a,b);item.appendChild(lab);
            if(Number.isFinite(v)){const meter=document.createElement("progress");meter.className="gc-meter";meter.max=100;meter.value=v;meter.setAttribute("aria-label",labels[k]);item.appendChild(meter);}cu.Metrics.appendChild(item);
        }
        const feature=(name,a,b)=>row(cu.Features,[name,fmt(a),fmt(b),Number.isFinite(a)&&Number.isFinite(b)?fmt(b-a):"—"]);
        for(const t of ["tap1","tap2"])for(const k of cmpKeys)feature(t+"."+k,rd[t].features[k],test[t].features[k]);
        for(const k of cmpPairKeys)feature("pair."+k,rd.pair[k],test.pair[k]);
        cu.Explanation.textContent=Number.isFinite(scores.overall)?"Porównanie opisowe: równoważna średnia pięciu kategorii. Nie jest to decyzja ACCEPT.":"Co najmniej jedna kategoria nieokreślona (np. brak energii GYRO) — brak ogólnego wyniku. N/D nie oznacza 0%.";
        comparatorStatus("Porównano test z "+ref.id+". Wynik eksperymentalny.");renderComparatorPlots();
    }
    cu.Reference.addEventListener("change",()=>{clearComparison();renderComparator();});
    cu.Record.addEventListener("click",()=>contactStart("comparator"));
    cu.Cancel.addEventListener("click",()=>{if(contactCapture.purpose==="comparator")contactCancel();});
    cu.Clear.addEventListener("click",()=>{comparatorTest=null;clearComparison();renderComparator();comparatorStatus("Wyczyszczono test. Biblioteka Learning bez zmian.");});
    cu.FromContact.addEventListener("click",()=>{const t=contactSelectedTrial();if(!t?.transportFinalized)return;try{loadComparatorTrial(t,"Contact #"+t.id,"CAP_DONE_CRC16_SEQ");}catch(e){comparatorStatus(e.message);}});
    cu.Import.addEventListener("change",async()=>{
        const file=cu.Import.files?.[0];if(!file)return;comparatorImporting=true;updateControls();
        try{if(file.size>2000000)throw new Error("Limit 2 MB/CSV");const t=window.GazelaGestureReplayUI.parseCsv(await file.text(),file.name);loadComparatorTrial(t,file.name,"CSV_SEQ_ONLY_NOT_CRC");}catch(e){comparatorStatus("Import: "+e.message);}finally{comparatorImporting=false;cu.Import.value="";updateControls();}
    });
    [cu.Tap1,cu.Tap2].forEach((el,j)=>el.addEventListener("change",()=>setComparatorAnchor(j,el.value.trim()===""?null:Number(el.value))));
    [cu.Acc,cu.Gyro].forEach(canvas=>canvas.addEventListener("click",e=>{if(!comparatorTest||contactIsBusy())return;const g=canvas._gslGeometry,rect=canvas.getBoundingClientRect();if(!g||!rect.width)return;const pos=(e.clientX-rect.left)*g.width/rect.width;if(pos<g.left||pos>g.right)return;setComparatorAnchor(Number(cu.AnchorMode.value)-1,Math.round((pos-g.left)/(g.right-g.left)*1599));}));
    cu.Suggest.addEventListener("click",()=>{const r=comparatorTest;if(!r)return;if(r.candidates.length!==2){comparatorStatus("Wymagane dokładnie dwa sugerowane impulsy; oznacz ręcznie ("+r.candidates.length+" kandydatów).");return;}r.anchors=r.candidates.map(c=>c.index);describe(r);clearComparison();renderComparator();comparatorStatus(r.error||"Podstawiono kandydatów. Zweryfikuj znaczniki ręcznie.");});
    cu.WaveMode.addEventListener("change",renderComparatorPlots);
    cu.Compare.addEventListener("click",runComparison);
    cu.Export.addEventListener("click",()=>{if(!comparatorTest)return;try{
        const {samples,...metadata}=comparatorTest;
        const rows=[["index","sequence","time_ms","AX_g","AY_g","AZ_g","GX_dps","GY_dps","GZ_dps"],...samples.map(s=>[s.index,s.sequence,s.time_ms,s.AX,s.AY,s.AZ,s.GX,s.GY,s.GZ])];
        const data={schema:"gazela.gesture.comparator.v1.experimental",exportedAt:new Date().toISOString(),sampleRateHz:400,test:metadata,result:comparatorResult};
        contactSaveBlob("GAZELA_GESTURE_TEST_"+Date.now()+".zip",contactBuildZip([["test.csv",contactCSV(rows)],["comparison.json",JSON.stringify(data,null,2)]]));comparatorStatus("Eksport testu ZIP gotowy.");
    }catch(e){comparatorStatus("Eksport: "+e.message);}});

    // V60 — save/import/export only explicitly selected immutable reference snapshots.
    function referenceStatus(message){ru.Status.textContent=message;}
    function librarySelection(){return savedReferences.get(ru.Select.value)||null;}
    function referenceRefresh(){
        const prior=ru.Select.value,key=JSON.stringify(Array.from(savedReferences.values(),r=>[r.id,r.name,r.type]));
        if(key!==referenceListKey){ru.Select.replaceChildren();const empty=document.createElement("option");empty.value="";empty.textContent=savedReferences.size?"Wybierz zapisany wzorzec":"Brak zapisanych wzorców";ru.Select.appendChild(empty);
            for(const r of savedReferences.values()){const o=document.createElement("option");o.value=r.id;o.textContent=r.name+" • "+(r.type==="single"?"GESTURE":`PROFILE (${r.profile.recordCount})`)+" • "+r.createdAt.slice(0,10);ru.Select.appendChild(o);}
            ru.Select.value=savedReferences.has(prior)?prior:"";referenceListKey=key;}
        const r=selected(),ref=librarySelection(),locked=referenceBusy||!referenceReady||contactIsBusy()||importing||comparatorImporting;
        ru.Name.disabled=locked;ru.SaveSingle.disabled=locked||r?.truth!=="gesture"||!r.description||r.description.overlappingWindows;
        ru.SaveProfile.disabled=locked||!profile;ru.Import.disabled=locked;ru.Select.disabled=locked||!savedReferences.size;
        for(const el of [ru.Use,ru.Export,ru.Delete])el.disabled=locked||!ref;
        ru.Info.textContent=`Lokalne wzorce: ${savedReferences.size}. `+(ref?`${ref.name} • ${ref.type==="single"?"1600 próbek + ręczne TAP1/TAP2":"Profil z "+ref.profile.recordCount+" gestów"} • ${ref.createdAt}. `:"Wybierz wzorzec z listy. ")+(ref?.profile&&!ref.profile.captureFingerprints.length?"Starszy import bez odcisków sygnałów uczących — nie można sprawdzić niezależności testu.":"Wzorce opisowe, nie zwalidowany klasyfikator.");
    }
    function libraryChanged(id){
        referenceListKey="";clearComparison();updateControls();
        if(id&&savedReferences.has(id)){ru.Select.value=id;cu.Reference.value=id;}
        referenceRefresh();renderComparator();
    }
    async function saveReference(raw,message){
        referenceBusy=true;updateControls();
        try{const ref=gazelaReferenceNormalize(raw);await gazelaReferenceTransaction(referenceDb,"readwrite",store=>store.add(ref));savedReferences.set(ref.id,ref);ru.Name.value="";libraryChanged(ref.id);referenceStatus(message+" • "+ref.name+". Zapis lokalny zakończony. "+(ref.profile&&!ref.profile.captureFingerprints.length?"Uwaga: brak odcisków nagrań uczących w starszym profilu.":""));}
        catch(e){referenceStatus("Nie zapisano wzorca: "+e.message);}
        finally{referenceBusy=false;updateControls();}
    }
    function makeReference(type,source,name){return {schema:GAZELA_REFERENCE_SCHEMA,id:gazelaReferenceMakeId(),name,createdAt:new Date().toISOString(),type,config:GAZELA_REFERENCE_CONFIG,...(type==="single"?{record:source}:{profile:source})};}
    ru.SaveSingle.addEventListener("click",()=>{const r=selected();if(ru.SaveSingle.disabled||!r)return;void saveReference(makeReference("single",r,ru.Name.value.trim()||"DOUBLE TAP — "+r.id),"Zapisano gest referencyjny");});
    ru.SaveProfile.addEventListener("click",()=>{if(ru.SaveProfile.disabled||!profile)return;void saveReference(makeReference("profile",profile,ru.Name.value.trim()||`DOUBLE TAP — PROFILE ${profile.recordCount}`),"Zapisano profil referencyjny");});
    ru.Select.addEventListener("change",referenceRefresh);
    ru.Use.addEventListener("click",()=>{const ref=librarySelection();if(ru.Use.disabled||!ref)return;cu.Reference.value=ref.id;clearComparison();renderComparator();referenceStatus("Wzorzec aktywny w Comparator: "+ref.name);});
    ru.Export.addEventListener("click",()=>{const ref=librarySelection();if(ru.Export.disabled||!ref)return;try{contactSaveBlob("GAZELA_"+ref.id+".json",new Blob([JSON.stringify(ref,null,2)],{type:"application/json"}));referenceStatus("Eksport JSON: "+ref.name+". Zachowaj plik jako kopię lub przenieś na inne urządzenie.");}catch(e){referenceStatus("Eksport: "+e.message);}});
    ru.Import.addEventListener("change",async()=>{
        const file=ru.Import.files?.[0];if(!file||ru.Import.disabled)return;referenceBusy=true;updateControls();
        try{if(file.size>2000000)throw new Error("Limit 2 MB/JSON");const raw=JSON.parse(await file.text());let ref;
            if(raw.schema===GAZELA_SIGNATURE_VERSION){ref=makeReference("profile",raw,ru.Name.value.trim()||file.name.replace(/\.json$/i,"").slice(0,100));}
            else{ref={...raw,id:gazelaReferenceMakeId()};}
            await saveReference(ref,"Zaimportowano wzorzec");
        }catch(e){referenceStatus("Import odrzucony: "+e.message);}finally{ru.Import.value="";referenceBusy=false;updateControls();}
    });
    ru.Delete.addEventListener("click",async()=>{
        const ref=librarySelection();if(ru.Delete.disabled||!ref||!window.confirm("Usunąć lokalny wzorzec: "+ref.name+"? Kopia JSON, jeśli istnieje, pozostanie."))return;
        referenceBusy=true;updateControls();try{await gazelaReferenceTransaction(referenceDb,"readwrite",store=>store.delete(ref.id));savedReferences.delete(ref.id);libraryChanged(null);referenceStatus("Usunięto lokalny wzorzec: "+ref.name);}catch(e){referenceStatus("Nie usunięto wzorca: "+e.message);}finally{referenceBusy=false;updateControls();}
    });
    async function initReferences(){
        try{referenceDb=await gazelaReferenceOpen();const rows=await gazelaReferenceTransaction(referenceDb,"readonly",store=>store.getAll());let skipped=0;
            for(const raw of rows){try{const r=gazelaReferenceNormalize(raw);savedReferences.set(r.id,r);}catch(e){skipped++;}}
            referenceReady=true;referenceStatus(`Baza lokalna gotowa: ${savedReferences.size} wzorców.`+(skipped?` Pominięto niezgodne wpisy: ${skipped}.`:""));libraryChanged(savedReferences.keys().next().value);return true;
        }catch(e){referenceStatus("Zapis lokalny niedostępny: "+e.message+". Learning i Comparator sesyjny nadal działają.");return false;}
        finally{referenceBusy=false;updateControls();}
    }
    // Shared, read-only API for a future offline recognizer. No detection or ACCEPT in V60.
    window.GazelaReferenceLibrary=Object.freeze({schema:GAZELA_REFERENCE_SCHEMA,
        ready:()=>referenceInitPromise,
        list:()=>Array.from(savedReferences.values(),r=>({id:r.id,name:r.name,type:r.type,createdAt:r.createdAt,recordCount:r.profile?.recordCount||1,validated:false})),
        get:id=>savedReferences.has(id)?gazelaReferenceClone(savedReferences.get(id)):null,
        describe:id=>savedReferences.has(id)?gazelaReferenceClone(referenceDescription(savedReferences.get(id))):null,
        compare:(id,samples,tap1,tap2)=>{const ref=savedReferences.get(id);if(!ref)throw new Error("Wzorzec nie istnieje");const test=gazelaSignatureDescribe(samples,tap1,tap2);if(test.overlappingWindows)throw new Error("Nakładające się okna");const fp=gazelaReferenceFingerprint(samples);if(ref.captureFingerprint===fp||ref.profile?.captureFingerprints.includes(fp))throw new Error("Próba należy do wzorca");return {...compareDescriptions(referenceDescription(ref),test),validated:false,trainingIdentityAvailable:!!ref.captureFingerprint||!!ref.profile?.captureFingerprints.length};}
    });
    const referenceInitPromise=initReferences();
    window.GazelaSignatureLab=Object.freeze({refresh:updateControls,status,commit,kind:()=>ui.Kind.value,comparatorStatus,commitComparator});
    window.addEventListener("resize",()=>{const r=selected();plot(ui.Acc,["AX","AY","AZ"],r);plot(ui.Gyro,["GX","GY","GZ"],r);renderWaves();renderComparatorPlots();});
    render();
    renderComparator();
})();
// END STAGE 8.9
