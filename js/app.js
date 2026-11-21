// app.js — GAZELA SENSOR LAB V65.3 (transport isolation; recovery OFF by default) / STAGE 8.11 HR400 ORIENTATION-INVARIANT COMPARATOR / V28.1 HR400
// V63: comparator uses one common fitted Y rotation for ACC+GYRO and both taps.
// V62: serialize BLE command writes; start packet timeout only after write completion;
//      prevent outdated queued N requests; reduce UI work in all HR400 modules.
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
const BLE_RAW400_CHARACTERISTIC_UUID =
    "7a1e0004-5a9a-4c71-9b3a-47415a5a0001";
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
        this.raw400Characteristic = null;
        this.controlService = null;
        this.commandCharacteristic = null;
        this.decoder =
            new TextDecoder();
        this.notificationCount = 0;
        this.boundNotificationHandler =
            this.handleNotification.bind(this);
        this.boundContactCaptureHandler = event => contactReceiveDataPacket(event);
        this.boundRaw400Handler = event => window.GazelaSessionV65?.onRawPacket(event.target.value);
        this.boundDisconnectHandler =
            this.handleDisconnected.bind(this);
        // Prevent duplicate handling of the same BLE disconnect event.
        this.disconnectHandled = false;
        // V62: ONE in-flight GATT command write per connection. The browser may
        // deliver a notification before writeValueWithResponse() has settled.
        this.gattWriteTail = Promise.resolve();
        this.gattWriteQueueClosed = false;
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
        // V65: optional RAW 400 Hz characteristic. V28.1 legacy BLE remains connectable.
        try {
            this.raw400Characteristic = await this.sensorService.getCharacteristic(BLE_RAW400_CHARACTERISTIC_UUID);
            this.raw400Characteristic.addEventListener('characteristicvaluechanged', this.boundRaw400Handler);
            await this.raw400Characteristic.startNotifications();
            addSerialLine('V65: RAW400 notifications subscribed (packet up to 110 bytes)', 'serial-info');
        } catch (rawError) {
            this.raw400Characteristic = null;
            addSerialLine('V65: RAW400 unavailable; V29 firmware required: '+rawError.message, 'serial-info');
        }
        this.running = true;
        window.GazelaSessionV65?.onConnectionChanged();
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
            for (const message of messages) {if(message.startsWith('STREAM,STOPPED,'))window.GazelaSessionV65?.onStreamStopped(message);window.GazelaSessionV65?.onStreamMessage(message);this.onLine(message);}
        } catch (error) {
            console.error("BLE notification error:", error);
            addSerialLine("BLE notification error: " + error.message, "serial-error");
        }
    }
    cancelSessionReplayCommands() {
        // Skip every queued R<SEQ> from the old acquisition epoch; do not
        // interrupt an already-running Web Bluetooth GATT operation.
        this.rawReplayEpoch = (this.rawReplayEpoch || 0) + 1;
    }
    async send(command, stillCurrent = null) {
        const replayEpoch = this.rawReplayEpoch || 0;
        // V62: all command writers (L/S/Q/C/N/F/X) share this FIFO promise chain.
        // An N[index] notification may arrive before the previous GATT WRITE
        // promise settles. Serializing writes prevents "GATT operation in progress".
        // The optional guard skips a queued N[index] if it has already arrived
        // or the capture was cancelled; false means "skipped", not an error.
        const data = new TextEncoder().encode(command);
        const task = this.gattWriteTail.then(async () => {
            if (this.gattWriteQueueClosed || !this.running ||
                !this.device?.gatt?.connected || !this.commandCharacteristic) {
                throw new Error("BLE zostało rozłączone lub nie jest gotowe do zapisu GATT.");
            }
            if (command.startsWith('R') && replayEpoch !== (this.rawReplayEpoch || 0)) return false;
            if (stillCurrent && !stillCurrent()) return false;
            if (typeof this.commandCharacteristic.writeValueWithResponse === "function") {
                await this.commandCharacteristic.writeValueWithResponse(data);
            } else {
                await this.commandCharacteristic.writeValue(data);
            }
            return true;
        });
        // A rejected write must not poison the queue for later commands.
        this.gattWriteTail = task.catch(() => {});
        return task;
    }
    async disconnect() {
        // V62: invalidate queued commands BEFORE closing the connection.
        // stopNotifications() is itself a GATT operation and could race with an
        // in-flight write. Disconnecting GATT stops notifications on the device;
        // do not start new stopNotifications() operations during teardown.
        this.gattWriteQueueClosed = true;
        this.running = false;
        if (this.raw400Characteristic) {
            try { this.raw400Characteristic.removeEventListener('characteristicvaluechanged', this.boundRaw400Handler); }
            catch (e) { console.warn('V65 raw GATT listener:', e); }
        }
        if (this.contactCaptureCharacteristic) {
            try { this.contactCaptureCharacteristic.removeEventListener("characteristicvaluechanged", this.boundContactCaptureHandler); }
            catch (error) { console.warn(error); }
        }
        if (this.liveCharacteristic) {
            try { this.liveCharacteristic.removeEventListener("characteristicvaluechanged", this.boundNotificationHandler); }
            catch (error) { console.warn(error); }
        }
        if (this.device) {
            try { this.device.removeEventListener("gattserverdisconnected", this.boundDisconnectHandler); }
            catch (error) { console.warn(error); }
            if (this.device.gatt?.connected) {
                try { this.device.gatt.disconnect(); }
                catch (error) { console.warn("BLE disconnect:", error); }
            }
        }
        this.device = null;
        this.server = null;
        this.sensorService = null;
        this.liveCharacteristic = null;
        this.contactCaptureCharacteristic = null;
        this.raw400Characteristic = null;
        this.controlService = null;
        this.commandCharacteristic = null;
    }
    handleDisconnected() {
        if (this.disconnectHandled) return;
        this.disconnectHandled = true;
        this.gattWriteQueueClosed = true;
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
        if (this.raw400Characteristic) {
            try { this.raw400Characteristic.removeEventListener('characteristicvaluechanged', this.boundRaw400Handler); }
            catch (e) { console.warn('V65 raw GATT listener:', e); }
        }
        if (this.contactCaptureCharacteristic) {
            try { this.contactCaptureCharacteristic.removeEventListener("characteristicvaluechanged", this.boundContactCaptureHandler); }
            catch (error) { console.warn(error); }
        }
        this.server = null;
        this.sensorService = null;
        this.liveCharacteristic = null;
        this.contactCaptureCharacteristic = null;
        this.raw400Characteristic = null;
        this.controlService = null;
        this.commandCharacteristic = null;
        window.GazelaSessionV65?.onBLEDisconnect();
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
    // V64: 50Hz diagnostic monitoring and manual annotations only.
    if (window.GazelaSessionV64) window.GazelaSessionV64.onLiveFrame({AX,AY,AZ,GX,GY,GZ,fifoSeq:fifoSequence});
 
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
    // V65: BLE transport ownership is set only after candidate.connect().
    window.GazelaSessionV65?.onConnectionChanged();
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
    if (kind === "ble" || kind === "all") {
        contactDisconnected();
        // V64: end a monitoring-only session when the sensor disconnects.
        if (window.GazelaSessionV64) window.GazelaSessionV64.onBLEDisconnect();
    }
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
// V62: while receiving 1600 packets, update ONLY the visible counters and
// progress bar; do not recalculate session stats, redraw reports or re-render
// the Gesture Learning / Comparator interface after every 20 packets.
function contactTransferProgressRefresh() {
    gestureTransferRefresh();
    if (contactUI.samples) contactUI.samples.textContent = `${contactCapture.data.length} / ${contactCapture.total}`;
    if (contactUI.phase) contactUI.phase.textContent = contactCapture.state.toUpperCase();
    if (contactUI.integrity) contactUI.integrity.textContent = contactCapture.state === "done" ? "PASS" : contactCapture.state === "failed" ? "FAIL" : "—";
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
    const generation = contactCapture.attemptId;
    const transport = bleTransport;
    // Do not let a delayed queued write request a sample from a previous
    // attempt, or re-request a packet that has already passed CRC16 and SEQ.
    const stillCurrent = () => (
        contactCapture.state === "downloading" &&
        contactCapture.attemptId === generation &&
        contactCapture.expected === index &&
        bleTransport === transport
    );
    try {
        // V62: the GATT command queue waits until the PREVIOUS write settles.
        // The packet might arrive while this write is still pending. In that
        // case expected changes, the next request queues safely, and no stale
        // timer is installed for this index.
        const sent = await transport.send("N" + index, stillCurrent);
        if (!sent || !stillCurrent()) return;
        if (contactCapture.packetTimer) clearTimeout(contactCapture.packetTimer);
        contactCapture.packetTimer = setTimeout(() => {
            if (!stillCurrent()) return;
            contactCapture.retries++;
            contactCapture.retryTotal++;
            if (contactCapture.retries > 6) {
                contactFail("brak pakietu #" + index + " po 6 ponowieniach");
                return;
            }
            contactRequest(index);
        },2500);
    }
    catch (error) {
        if (stillCurrent()) contactFail(error.message);
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
    // V62: progress-only UI while downloading, across all three modules.
    // Full refresh remains on phase changes and after CAP,DONE.
    if (index%20 === 0 || contactCapture.expected === contactCapture.total) {
        contactTransferProgressRefresh();
    }
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
    const cu=Object.fromEntries(["Reference","ReferenceInfo","Record","Cancel","Import","FromContact","Clear","Status","AnchorMode","Tap1","Tap2","Suggest","Candidates","Acc","Gyro","Compare","Export","Overall","RawOverall","MatchedAngle","Metrics","Explanation","WaveMode","WaveOrientation","WaveAcc","WaveGyro","Features"].map(id=>[id,document.getElementById("gc"+id)]));
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
        cu.Overall.textContent="—";cu.RawOverall.textContent="—";cu.MatchedAngle.textContent="—";
        cu.Metrics.replaceChildren();cu.Features.replaceChildren();cu.WaveOrientation.value="raw";
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
        const testWave=r?.tapFeatures[j]?.waveform||null;
        const rotate=cu.WaveOrientation.value==="normalized"&&Number.isFinite(comparatorResult?.orientationNormalization?.matchedAngleDeg);
        const waves=[referenceDescription(currentReference())?.[which]?.waveform||null,
            rotate&&testWave?gazelaRotateWaveformY(testWave,comparatorResult.orientationNormalization.matchedAngleDeg):testWave];
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
    // V63: body-fixed raw ACC/GYRO and the original features stay unchanged. Only
    // the comparator's temporary waveform view is rotated. A single common Y
    // rotation is used for TAP1/TAP2 and ACC/GYRO — NEVER an axis-by-axis sign fit.
    // The fitted angle is relative to the reference, NOT measured court/world attitude.
    function gazelaRotateWaveformY(waveform,degrees){
        const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
        const rotate=v=>[c*v[0]+s*v[2],v[1],-s*v[0]+c*v[2]];
        return waveform.map(w=>({offsetMs:w.offsetMs,acc:rotate(w.acc),gyro:rotate(w.gyro)}));
    }
    function gazelaFindBestRotationY(ref,test){
        const taps=["tap1","tap2"],raw={};
        for(const key of ["acc","gyro"])raw[key]=taps.map(t=>ref[t].waveform.flatMap(w=>w[key]));
        const trialAngle=angle=>{
            const waves=Object.fromEntries(taps.map(t=>[t,gazelaRotateWaveformY(test[t].waveform,angle)]));
            const cos=(key,i)=>similarityCos(raw[key][i],waves[taps[i]].flatMap(w=>w[key]));
            const acc=[0,1].map(i=>cos("acc",i)),gyro=[0,1].map(i=>cos("gyro",i));
            const good=[...acc,...gyro].filter(Number.isFinite);
            return {angle,score:good.length===4?good.reduce((a,b)=>a+b,0)/good.length:-Infinity};
        };
        let best=trialAngle(0);
        // Coarse sweep followed by local refinement; this is small (~160k samples)
        // and runs only when the user presses COMPARE, never in the BLE stream.
        for(let angle=1;angle<360;angle+=1){const candidate=trialAngle(angle);if(candidate.score>best.score+1e-9)best=candidate;}
        const coarseAngle=best.angle;
        for(let offset=-0.9;offset<=0.91;offset+=0.1){
            const angle=(((coarseAngle+offset)%360)+360)%360;
            const candidate=trialAngle(angle);if(candidate.score>best.score+1e-9)best=candidate;
        }
        return Number.isFinite(best.score)?{matchedAngleDeg:Math.round(best.angle*10)/10,score:best.score}:{matchedAngleDeg:0,score:null};
    }
    // Scores remain descriptive similarities, not calibrated probabilities.
    // No time warping and no modification of the underlying trial samples.
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
        clearComparison();
        const rd=referenceDescription(ref), rawScores=compareDescriptions(rd,test);
        const fit=gazelaFindBestRotationY(rd,test);
        const transformed={...test,tap1:{...test.tap1,waveform:gazelaRotateWaveformY(test.tap1.waveform,fit.matchedAngleDeg)},tap2:{...test.tap2,waveform:gazelaRotateWaveformY(test.tap2.waveform,fit.matchedAngleDeg)}};
        const scores=compareDescriptions(rd,transformed);
        const labels={accShape:"ACC — kształt",gyroShape:"GYRO — kształt",amplitude:"Amplituda impulsów",timing:"Czas i odstęp",structure:"Struktura gestu"};
        comparatorResult={schema:"gazela.gesture.comparator.v1.experimental",referenceId:ref.id,referenceName:ref.name||ref.label,referenceType:ref.record?"single":"profile",referenceCreatedAt:ref.createdAt||null,referenceConfig:ref.config||GAZELA_REFERENCE_CONFIG,reference:rd,testDescription:test,metrics:scores.metrics,overall:scores.overall,rawMetrics:rawScores.metrics,rawOverall:rawScores.overall,orientationNormalization:{method:"one_constant_rotation_about_GAZELA_Y",matchedAngleDeg:fit.matchedAngleDeg,comparisonFrame:"relative_reference",scope:"TAP1_TAP2_ACC_GYRO",rawDataChanged:false},validated:false};
        cu.Overall.textContent=Number.isFinite(scores.overall)?scores.overall.toFixed(1)+"%":"—";
        cu.RawOverall.textContent=Number.isFinite(rawScores.overall)?rawScores.overall.toFixed(1)+"%":"—";
        cu.MatchedAngle.textContent=Number.isFinite(fit.score)?fit.matchedAngleDeg.toFixed(1)+"°":"N/D";
        for(const [k,v] of Object.entries(scores.metrics)){
            const item=document.createElement("div");item.className="gc-metric";
            const lab=document.createElement("div");lab.className="gc-metric-label";const a=document.createElement("span"),b=document.createElement("span");a.textContent=labels[k];b.textContent=Number.isFinite(v)?v.toFixed(1)+"%":"N/D";lab.append(a,b);item.appendChild(lab);
            if(Number.isFinite(v)){const meter=document.createElement("progress");meter.className="gc-meter";meter.max=100;meter.value=v;meter.setAttribute("aria-label",labels[k]);item.appendChild(meter);}cu.Metrics.appendChild(item);
        }
        const feature=(name,a,b)=>row(cu.Features,[name,fmt(a),fmt(b),Number.isFinite(a)&&Number.isFinite(b)?fmt(b-a):"—"]);
        for(const t of ["tap1","tap2"])for(const k of cmpKeys)feature(t+"."+k,rd[t].features[k],test[t].features[k]);
        for(const k of cmpPairKeys)feature("pair."+k,rd.pair[k],test.pair[k]);
        cu.Explanation.textContent=Number.isFinite(scores.overall)?"V63: wynik po dopasowaniu jednego kąta Y dla TAP1/TAP2 i ACC/GYRO; wynik RAW obok. Kąt to dopasowanie matematyczne względem wzorca, nie zmierzona orientacja rakiety. Dane surowe i eksport test.csv są niezmienione. Brak decyzji ACCEPT.":"Co najmniej jedna kategoria nieokreślona (np. brak energii GYRO) — brak ogólnego wyniku. N/D nie oznacza 0%.";
        comparatorStatus("Porównano test z "+ref.id+". RAW i NORMALIZED Y 360°; wynik eksperymentalny.");renderComparatorPlots();
    }
    cu.Reference.addEventListener("change",()=>{clearComparison();renderComparator();});
    cu.WaveOrientation.addEventListener("change",renderComparatorPlots);
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

// ================================================================
// GAZELA V65.3 — RAW 400Hz BLE / TRANSPORT ISOLATION / RETRANSMISSION SWITCH
// Uses the existing V63/V64 contact detector and gesture model.
// Experimental detector output != confirmed ball impact or verified gesture.
// ================================================================
(function gazelaV65SessionEngine(){
"use strict";
const $=id=>document.getElementById(id);
const ui={mode:$('v64Mode'),import:$('v64Import'),file:$('v64FileStatus'),start:$('v64Start'),stop:$('v64Stop'),exp:$('v64Export'),recover:$('v65Recover'),storage:$('v65Storage'),transportOnly:$('v651TransportOnly'),retransmission:$('v653Retransmission'),status:$('v64Status'),clock:$('v64Time'),samples:$('v64Samples'),integrity:$('v64Integrity'),bar:$('v64Progress'),ac:$('v64AutoContact'),ag:$('v64AutoGesture'),mc:$('v64ManualContact'),mg:$('v64ManualGesture'),markC:$('v64MarkContact'),markG:$('v64MarkGesture'),undo:$('v64Undo'),sound:$('v64Sound'),events:$('v64EventList'),marks:$('v64LabelList'),reference:$('v64Reference'),referenceStatus:$('v64ReferenceStatus'),rate:$('v64Rate'),notes:$('v64Notes')};
if(!ui.start)return;
const UUID='7a1e0004-5a9a-4c71-9b3a-47415a5a0001';
const PERIOD_MS=2.5, MAX_IMPORT_BYTES=16000000, MAX_REPLAY=120000;
const AXES=['AX','AY','AZ','GX','GY','GZ'];
let s=null, source=null, timer=null, audioCtx=null, writer=null, renderAt=0, replayAt=0, replayIndex=0, statusAt=0, dbPromise=null;
const text=(tag,cl,t)=>{const x=document.createElement(tag);if(cl)x.className=cl;x.textContent=t;return x;};
const clock=t=>{if(!Number.isFinite(t))return '—';const n=Math.max(0,Math.round(t));return String(Math.floor(n/60000)).padStart(2,'0')+':'+String(Math.floor(n%60000/1000)).padStart(2,'0')+'.'+String(n%1000).padStart(3,'0');};
const say=(msg,type='info')=>{ui.status.textContent=msg;ui.status.dataset.state=type;};
const id=()=>`GZ653-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
const csv=rows=>rows.map(r=>r.map(v=>{const v0=String(v??'');return /[",\r\n]/.test(v0)?'"'+v0.replace(/"/g,'""')+'"':v0;}).join(',')).join('\r\n')+'\r\n';
function crc16(b,len=b.length){let crc=65535;for(let i=0;i<len;i++){crc^=b[i]<<8;for(let k=0;k<8;k++)crc=((crc<<1)^((crc&32768)?0x1021:0))&65535;}return crc;}
// The complete GATT notification is an atomic packet, not a serial byte stream.
function decodePacket(value){const a=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
 if(a.length<26||a[0]!==71||a[1]!==90||a[2]!==1)throw Error('RAW_MAGIC_OR_VERSION');
 const n=a[3];if(n<1||n>8||a.length!==14+12*n)throw Error('RAW_LENGTH');
 const dv=new DataView(a.buffer,a.byteOffset,a.byteLength), check=dv.getUint16(a.length-2,true);
 if(crc16(a,a.length-2)!==check)throw Error('RAW_CRC16');
 const seq=dv.getUint32(4,true), timeUs=dv.getUint32(8,true), out=[];
 for(let i=0;i<n;i++){const rec={sequence:(seq+i)>>>0,time_us_nominal:(timeUs+i*2500)>>>0};for(let j=0;j<6;j++)rec[AXES[j]]=dv.getInt16(12+i*12+j*2,true)/(j<3?1000:10);out.push(rec);}
 return {seq,timeUs,out,bytes:a.slice()}; }
function dbOpen(){if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('GAZELA_CONTINUOUS_SESSIONS_V65',1);
 req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('sessions',{keyPath:'id'});db.createObjectStore('chunks',{keyPath:['sessionId','part']});};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});return dbPromise;}
async function dbPut(store,record){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('STORAGE_ABORT'));});}
async function dbGet(store,key){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function dbAll(store){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function queueWrite(work){if(!s)return;const ref=s;
 ref.writeTail=(ref.writeTail||Promise.resolve()).then(work).catch(e=>{ref.storageError=String(e);ref.diagnostics.push({kind:'STORAGE_ERROR',error:String(e),at:new Date().toISOString()});say('BŁĄD ZAPISU LOKALNEGO. Zatrzymano sesję: '+e.message,'error');if(ref.state==='recording')void stop('STORAGE_ERROR');});}
function smallManifest(ref){return {id:ref.id,schema:'gazela.continuous.v65',version:'V65.3_TRANSPORT_ISOLATION',mode:ref.mode,state:ref.state,startedAt:ref.startedAt,endedAt:ref.endedAt,stopReason:ref.stopReason,source:ref.sourceName,firstSeq:ref.firstSeq,lastSeq:ref.lastSeq,sampleCount:ref.samples,frames:ref.frames,parts:ref.parts,gaps:ref.gaps,missingSamples:ref.missingSamples,crcErrors:ref.crcErrors,decoderErrors:ref.decoderErrors,referenceId:ref.referenceId,referenceName:ref.referenceName,events:ref.events,manual:ref.manual,diagnostics:ref.diagnostics.slice(-400),storageError:ref.storageError,retransmissionEnabled:!!ref.retransmissionEnabled,replayRequests:ref.replayRequests||0,recoveredFrames:ref.recoveredFrames||0,duplicates:ref.duplicates||0,receiverFrames:ref.rxFrames||0,transportOnly:!!ref.transportOnly,firmwareStop:ref.firmwareStop||null,startSequence:ref.startSequence??null,finalExpectedSeq:ref.finalExpectedSeq??null,stopCommandAcknowledged:!!ref.stopAckSeen,stopButtonPressedAt:ref.stopButtonPressedAt||null,stopAcknowledgementTimedOut:!!ref.stopAckTimedOut,emergencyStop:!!ref.emergencyStop,quantization:'ACC 0.001g, GYRO 0.1deg/s; nominal 2.5ms; not hardware SensorTime'};}
function saveManifest(ref){if(ref.mode!=='ble400')return;queueWrite(()=>dbPut('sessions',smallManifest(ref)));}
function flushPackets(ref){if(ref.mode!=='ble400'||!ref.pending.length)return;const packets=ref.pending;ref.pending=[];const part=ref.parts++;
 queueWrite(async()=>{await dbPut('chunks',{sessionId:ref.id,part,packets});await dbPut('sessions',smallManifest(ref));});}
function sound(type){if(!ui.sound.checked)return;try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;if(!audioCtx)audioCtx=new AC();if(audioCtx.state==='suspended')void audioCtx.resume();const now=audioCtx.currentTime+.01;
 const beep=(hz,delay,length)=>{const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.frequency.value=hz;gain.gain.setValueAtTime(.0001,now+delay);gain.gain.exponentialRampToValueAtTime(.13,now+delay+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+length);osc.connect(gain);gain.connect(audioCtx.destination);osc.start(now+delay);osc.stop(now+delay+length+.02);};
 if(type.startsWith('GESTURE')){beep(720,0,.08);beep(1050,.11,.11);}else beep(370,0,.12);}catch(e){console.warn('GAZELA V65 AUDIO',e);}}
function controls(){const run=s?.state==='recording',stopping=s?.state==='stopping',busy=run||stopping,connected=!!(bleTransport?.running&&bleTransport.raw400Characteristic);
 ui.start.disabled=busy||(ui.mode.value==='ble400'&&!connected)||(ui.mode.value==='replay'&&!source);
 // The second press is an explicit emergency STOP, never a disabled control.
 ui.stop.disabled=!busy;ui.stop.textContent=stopping?'AWARYJNY STOP / ROZŁĄCZ BLE':'STOP SESSION';
 ui.stop.classList.toggle('v652-stopping',!!stopping);
 ui.markC.disabled=!run;ui.markG.disabled=!run;ui.undo.disabled=!s?.manual?.length;
 ui.exp.disabled=!s||busy;ui.mode.disabled=run;ui.import.disabled=run;ui.reference.disabled=run;ui.rate.disabled=run;if(ui.transportOnly)ui.transportOnly.disabled=run;if(ui.retransmission)ui.retransmission.disabled=busy;
 if(ui.recover)ui.recover.disabled=run;
}
function newSession(mode){const ref=window.GazelaReferenceLibrary?.get(ui.reference.value)||null;
 return {id:id(),mode,state:'recording',startedAt:new Date().toISOString(),endedAt:null,stopReason:null,sourceName:source?.name||null,firstSeq:null,lastSeq:null,samples:0,frames:0,rxFrames:0,replayRequests:0,recoveredFrames:0,duplicates:0,transportOnly:!!ui.transportOnly?.checked,retransmissionEnabled:!!ui.retransmission?.checked,firmwareStop:null,startSequence:null,finalExpectedSeq:null,parts:0,gaps:0,missingSamples:0,crcErrors:0,decoderErrors:0,storageError:null,packetBuffer:new Map(),nextSeq:null,gapStartedAt:0,lastRecoveryAt:0,attemptedSeq:null,recoveryAttempts:0,recoveryFailed:new Set(),replayRequested:new Set(),pending:[],writeTail:Promise.resolve(),raw:[],events:[],manual:[],diagnostics:[],history:[],candidates:[],lastCandidate:-1e12,gesture:new GazelaGestureStreamRecognizerV1(),perfStart:performance.now(),lastPacketPerf:performance.now(),firstPacketPerf:null,lastSampleTime:0,ref,referenceId:ref?.id||null,referenceName:ref?.name||null,stopButtonPressedAt:null,stopRequestedPerf:null,stopFrozenSamples:null,stopFrozenTime:null,stopAckSeen:false,stopAckTimedOut:false,emergencyStop:false,stopFinalizePromise:null,stopResolver:null};}
function addEvent(type,base,extra){const item={id:'E'+(s.events.length+1),kind:'AUTO',type,index:base?.index??null,sequence:base?.sequence??null,time_ms:base?.time_ms??null,detector:type.startsWith('GESTURE')?'V65_DOUBLE_TAP_PAIR_V1':GAZELA_OFFLINE_DETECTOR_VERSION,algorithmUnvalidated:true,detectedAt:new Date().toISOString(),...extra};s.events.push(item);sound(type);return item;}
function ingest(raw){if(!s||(s.state!=='recording'&&s.state!=='stopping'))return;const seq=raw.sequence;
 if(s.firstSeq===null)s.firstSeq=seq;
 const index=(seq-s.firstSeq)>>>0;const prev=s.lastSeq;
 if(prev!==null){
   const advance=(seq-prev)>>>0;
   if(advance===0){s.diagnostics.push({kind:'DUPLICATE_SEQ',sequence:seq});return;}
   if(advance>0x80000000){s.diagnostics.push({kind:'OUT_OF_ORDER_SEQ',sequence:seq,previous:prev});return;}
   if(advance!==1){
     const missed=advance-1;s.gaps++;s.missingSamples+=missed;
     s.diagnostics.push({kind:'SEQ_GAP',expected:(prev+1)>>>0,received:seq,missing:missed});
     s.history=[];s.candidates=[];s.lastCandidate=-1e12;s.gesture=new GazelaGestureStreamRecognizerV1();
   }
 }
 const sample={...raw,index,time_ms:index*PERIOD_MS};s.lastSeq=seq;s.samples++;s.lastSampleTime=sample.time_ms;
 if(s.mode==='replay'){s.raw.push(sample);}else if(s.raw.length<1600){s.raw.push(sample);}else{s.raw[s.samples%1600]=sample;}
 s.history.push(sample);if(s.history.length>512)s.history.shift();
 if(s.transportOnly)return;
 s.gesture.pushSample(sample);
 if(index%12!==0||s.history.length<100)return;
 const result=gazelaDetectContactOffline(s.history);
 if(result.error){s.diagnostics.push({kind:'DETECTOR_ERROR',index,error:result.error});return;}
 const offset=s.history[0].index;
 for(const item of result.candidates){const c={...item,index:item.index+offset,peakIndex:item.peakIndex+offset,oppositeIndex:item.oppositeIndex+offset,eIndex:item.eIndex+offset};
  if(c.peakIndex>index-40||c.peakIndex<index-250||c.index<=s.lastCandidate+32)continue;
  s.lastCandidate=c.index;
  addEvent('CONTACT_CANDIDATE',{index:c.index,sequence:c.sequence,time_ms:c.timeMs},{score:c.score,deltaAccG:c.deltaAccG,e20G:c.e20G,contactBallConfirmed:false});
  let matchedV1=false;try{const old=s.gesture.gestures.length;s.gesture.pushCandidate(c);matchedV1=s.gesture.gestures.length>old;}catch(e){s.diagnostics.push({kind:'GESTURE_RULE_ERROR',error:String(e)});}
  const previous=s.candidates.at(-1), gap=previous?c.timeMs-previous.timeMs:null, st=s.ref?.profile?.statistics?.['pair.gapMs'];
  const base=s.ref?.record?.description?.pair?.gapMs;
  const low=Number.isFinite(st?.p10)?Math.max(120,st.p10-40):Number.isFinite(base)?Math.max(120,base-70):180;
  const high=Number.isFinite(st?.p90)?st.p90+40:Number.isFinite(base)?base+70:350;
  if(previous&&!previous.used&&gap>=low&&gap<=high){previous.used=true;addEvent('GESTURE_CANDIDATE_DOUBLE_TAP',{index:c.index,sequence:c.sequence,time_ms:c.timeMs},{tap1_seq:previous.sequence,tap2_seq:c.sequence,gap_ms:gap,referenceId:s.referenceId,v1_rule:matchedV1,matched:true,validated:false});}
  s.candidates.push({...c,used:false});if(s.candidates.length>10)s.candidates.shift();
 }
}
// V65.1: receive out-of-order retransmissions, but feed classifiers ONLY in
// increasing SEQ order. Store all unique good GATT frames in IndexedDB.
const REPLAY_RETRY_MS=300, REPLAY_MAX_ATTEMPTS=4, REPLAY_TIMEOUT_MS=1750;
const MAX_PENDING_PACKET_FRAMES=110;
function unsignedAhead(a,b){return ((a-b)>>>0)<0x80000000;}
function drainOrdered(ref){
 if(!ref||ref.nextSeq===null)return;
 let advanced=false;
 while(ref.packetBuffer.has(ref.nextSeq)){
  const pkt=ref.packetBuffer.get(ref.nextSeq);
  ref.packetBuffer.delete(ref.nextSeq);
  // A missing packet may have been received late (recovery request in flight).
  for(const raw of pkt.out)ingest(raw);
  ref.nextSeq=(ref.nextSeq+pkt.out.length)>>>0;
  advanced=true;
 }
 if(advanced){ref.gapStartedAt=0;ref.attemptedSeq=null;ref.recoveryAttempts=0;}
 if(!ref.packetBuffer.size){
  if(ref.finalExpectedSeq!==null&&ref.nextSeq!==ref.finalExpectedSeq&&unsignedAhead(ref.finalExpectedSeq,ref.nextSeq)){
   if(!ref.gapStartedAt)ref.gapStartedAt=performance.now();
   const overdue=performance.now()-ref.gapStartedAt;
   if(ref.recoveryFailed.has(ref.nextSeq)||overdue>REPLAY_TIMEOUT_MS){
    const missing=(ref.finalExpectedSeq-ref.nextSeq)>>>0;
    ref.gaps++;ref.missingSamples+=missing;
    ref.diagnostics.push({kind:'UNRECOVERED_TRAILING_SEQ',expected:ref.nextSeq,finalExpected:ref.finalExpectedSeq,missing});
    ref.nextSeq=ref.finalExpectedSeq;ref.gapStartedAt=0;
   }else requestRecovery(ref,ref.nextSeq);
  }else ref.gapStartedAt=0;
  return;
 }
 // Use the first buffered future packet; the gap begins at nextSeq.
 const target=ref.nextSeq;
 const nearest=[...ref.packetBuffer.keys()].sort((x,y)=>(x-target>>>0)-(y-target>>>0))[0];
 if(!unsignedAhead(nearest,target)||nearest===target)return;
 if(!ref.gapStartedAt)ref.gapStartedAt=performance.now();
 const overdue=performance.now()-ref.gapStartedAt;
 if(ref.recoveryFailed.has(target)||overdue>REPLAY_TIMEOUT_MS||ref.packetBuffer.size>MAX_PENDING_PACKET_FRAMES){
  ref.diagnostics.push({kind:'REPLAY_UNRECOVERABLE',expected:target,nextAvailable:nearest,missing:(nearest-target)>>>0,afterMs:Math.round(overdue)});
  ref.nextSeq=nearest;
  ref.gapStartedAt=0;ref.attemptedSeq=null;ref.recoveryAttempts=0;
  drainOrdered(ref); // existing ingest() detects and records the permanent gap.
  return;
 }
 requestRecovery(ref,target);
}
function requestRecovery(ref,target){
 // V65.3: controlled A/B test. With the checkbox OFF, NEVER emit R<SEQ>.
 // Detection of missing SEQ, persistence, and STOP remain enabled.
 if(!ref.retransmissionEnabled)return;
 // Do not queue recovery requests ahead of the STOP command. After the MCU
 // confirms STOP, limited final recovery can proceed from the cache.
 if(ref.state==='stopped'||(ref.state==='stopping'&&!ref.stopAckSeen))return;
 if(!bleTransport?.running||!bleTransport?.raw400Characteristic)return;
 const now=performance.now();
 if(ref.attemptedSeq!==target){ref.attemptedSeq=target;ref.recoveryAttempts=0;ref.lastRecoveryAt=-1e12;}
 if(ref.recoveryAttempts>=REPLAY_MAX_ATTEMPTS || now-ref.lastRecoveryAt<REPLAY_RETRY_MS)return;
 ref.lastRecoveryAt=now;ref.recoveryAttempts++;ref.replayRequests++;
 ref.replayRequested.add(target);
 bleTransport.send('R'+target,()=>!!s&&s.id===ref.id&&
   (ref.state==='recording'||(ref.state==='stopping'&&ref.stopAckSeen))&&ref.nextSeq===target)
 .catch(e=>{ref.diagnostics.push({kind:'REPLAY_COMMAND_ERROR',seq:target,error:String(e)});});
}
function onRawPacket(value){
 if(!s||s.mode!=='ble400'||(s.state!=='recording'&&s.state!=='stopping'))return;
 const ref=s;
 try{
  const p=decodePacket(value),now=performance.now();
  ref.rxFrames++;ref.lastPacketPerf=now;
  if(ref.firstPacketPerf===null)ref.firstPacketPerf=now;
  if(ref.nextSeq===null){ref.nextSeq=ref.startSequence??p.seq;ref.firstSeq=ref.nextSeq;}
  if(!unsignedAhead(p.seq,ref.nextSeq)||ref.packetBuffer.has(p.seq)){
   // A delivered frame is already ingested (or already buffered).
   ref.duplicates++;
   return;
  }
  if(ref.replayRequested.has(p.seq)){
   ref.replayRequested.delete(p.seq);
   ref.recoveredFrames++;
   ref.diagnostics.push({kind:'REPLAY_FRAME_RECEIVED',firstSeq:p.seq,samples:p.out.length});
  }
  ref.packetBuffer.set(p.seq,p);
  ref.frames++;
  ref.pending.push(p.bytes); // Persist immediately even if ordering is pending.
  if(ref.pending.length>=100)flushPackets(ref);
  drainOrdered(ref);
  if(now-renderAt>175){renderAt=now;render();}
 }catch(e){
  const bad=String(e.message||e);
  if(bad.includes('CRC'))ref.crcErrors++;else ref.decoderErrors++;
  ref.diagnostics.push({kind:'RAW_PACKET_REJECTED',error:bad,at:new Date().toISOString()});
 }
}
function onStreamMessage(msg){
 if(!s||s.mode!=='ble400')return;
 if(msg.startsWith('STREAM,STARTED,')){
  const parts=msg.split(','),first=Number(parts[6]);
  if(Number.isSafeInteger(first)&&first>0){s.startSequence=first;}
 }
 if(msg.startsWith('STREAM,REPLAY_MISS,')){
  const seq=Number(msg.split(',')[2]);
  s.diagnostics.push({kind:'FIRMWARE_REPLAY_CACHE_MISS',sequence:seq});
  s.recoveryFailed.add(seq);
  if(s.nextSeq===seq)drainOrdered(s);
 }
}
function pressLabel(type){if(!s||s.state!=='recording')return;const perf=performance.now();const mark={id:'M'+(s.manual.length+1),type,pressedAt:new Date().toISOString(),pressMonotonicMs:perf,pressStreamTimeMs:perf-(s.mode==='ble400'&&s.firstPacketPerf!==null?s.firstPacketPerf:s.perfStart),nearestReceivedSequence:s.lastSeq,nearestReceivedRawTimeMs:s.lastSampleTime,eventTimeMs:null,eventSequence:null,linkedEventId:null,status:'UNLINKED',note:'PRESS TIME != PHYSICAL EVENT TIME; sync uncertainty includes BLE latency'};
 s.manual.push(mark);if(navigator.vibrate)navigator.vibrate(25);if(s.mode==='ble400')saveManifest(s);render(true);}
async function start(){const mode=ui.mode.value;
 if(mode==='ble400'&&!(bleTransport?.raw400Characteristic&&bleTransport.running)){say('Połącz Arduino V29.2.2 przez BLE. Wymagana charakterystyka RAW400 (0004).','error');return;}
 if(mode==='replay'&&!source){say('Wczytaj prawdziwy CSV 400 Hz.','error');return;}
 if(s?.state==='recording')return;
 if(ui.sound.checked){try{const AC=window.AudioContext||window.webkitAudioContext;if(AC){audioCtx=audioCtx||new AC();void audioCtx.resume();}}catch(e){console.warn(e);}}
 const ref=s=newSession(mode);controls();render(true);
 if(navigator.wakeLock?.request){void navigator.wakeLock.request('screen').then(lock=>{if(s&&s.state==='recording')s.wakeLock=lock;else void lock.release();}).catch(e=>{console.info('V65 wake lock unavailable',e);});}
 if(mode==='ble400'){
  try{if(!('indexedDB'in window))throw Error('IndexedDB niedostępne');await dbOpen();if(navigator.storage?.persist)void navigator.storage.persist();
   if(s!==ref||ref.state!=='recording')return;
   await dbPut('sessions',smallManifest(ref));
   if(s!==ref||ref.state!=='recording')return;
   const issued=await bleTransport.send('U8',()=>s===ref&&ref.state==='recording');
   if(s!==ref||ref.state!=='recording'||issued===false)return;
   say(ref.retransmissionEnabled?'U8 wysłano. Test z retransmisją ON.':'U8 wysłano. TRANSPORT ISOLATION: retransmisja OFF, zapis RAW 400 Hz aktywny.','warn');
   timer=setInterval(()=>{if(s!==ref||ref.state!=='recording')return;
    drainOrdered(s);
    if(performance.now()-s.lastPacketPerf>3500){void stop('RAW_TIMEOUT');say('RAW 400 Hz przerwany — STOP. Sprawdź BLE/MTU i eksport.','error');}
    else if(performance.now()-renderAt>500){renderAt=performance.now();render();}
   },150);
  }catch(e){if(s===ref&&ref.state==='recording'){ref.state='stopped';ref.stopReason='START_ERROR';say('Nie uruchomiono RAW: '+e.message,'error');controls();}}
 }else{replayIndex=0;replayAt=performance.now();timer=setInterval(replayTick,20);say('REPLAY RAW400: detektory działają na kolejnych próbkach CSV.','ok');}
}
function replayTick(){if(!s||s.state!=='recording'||!source)return;
 const elapsed=(performance.now()-replayAt)*Number(ui.rate.value);
 const upto=Math.min(source.samples.length,Math.floor(elapsed/PERIOD_MS)+1);
 while(replayIndex<upto){ingest(source.samples[replayIndex]);replayIndex++;}
 if(replayIndex===source.samples.length){void stop('REPLAY_COMPLETE');return;}
 if(performance.now()-renderAt>175){renderAt=performance.now();render();}
}
// STOP is a bounded user action, not an indefinite GATT write / recovery loop.
const STOP_ATTEMPT_MS=1450, STOP_SETTLE_MS=1100;
const delayMs=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stopFirmwareAttempt(ref){
 if(!bleTransport?.running)return 'BLE_NOT_CONNECTED';
 let timeoutId;
 const ack=new Promise(resolve=>{ref.stopResolver=resolve;});
 const timeout=new Promise(resolve=>{timeoutId=setTimeout(()=>resolve('STOP_TIMEOUT'),STOP_ATTEMPT_MS);});
 // Do not block on an unresolved browser GATT write. If an acknowledgement
 // is received before the write promise settles, it is sufficient.
 const write=bleTransport.send('U0').then(()=>new Promise(()=>{}),e=>{
   ref.diagnostics.push({kind:'STOP_WRITE_ERROR',error:String(e)});
   return 'WRITE_ERROR';
 });
 const result=await Promise.race([ack,write,timeout]);
 clearTimeout(timeoutId);
 ref.stopResolver=null;
 return ref.stopAckSeen?'ACK_OK':result;
}
function stopDrainBounded(ref){
 // Never use `while(packetBuffer.size)` without checking progress. A stale
 // or out-of-order key could otherwise freeze the entire mobile UI.
 const maxSteps=Math.min(MAX_PENDING_PACKET_FRAMES+16,ref.packetBuffer.size+16);
 for(let step=0;ref.packetBuffer.size&&step<maxSteps;step++){
   const beforeSize=ref.packetBuffer.size,beforeNext=ref.nextSeq;
   drainOrdered(ref);
   if(ref.packetBuffer.size<beforeSize||ref.nextSeq!==beforeNext)continue;
   const keys=[...ref.packetBuffer.keys()];
   const forward=keys.filter(x=>unsignedAhead(x,ref.nextSeq)).sort((a,b)=>((a-ref.nextSeq)>>>0)-((b-ref.nextSeq)>>>0));
   if(forward.length){
     const nearest=forward[0];
     if(nearest!==ref.nextSeq)ref.recoveryFailed.add(ref.nextSeq);
     drainOrdered(ref);
   }
   if(ref.packetBuffer.size>=beforeSize&&ref.nextSeq===beforeNext){
     // Packets were already persisted in `pending` / IndexedDB; these are
     // dropped only from the classifier's pending ordering map.
     ref.diagnostics.push({kind:'STOP_DRAIN_STALLED',nextSequence:ref.nextSeq,pendingFrames:ref.packetBuffer.size});
     ref.packetBuffer.clear();break;
   }
 }
 if(ref.packetBuffer.size){
   ref.diagnostics.push({kind:'STOP_DRAIN_LIMIT',pendingFrames:ref.packetBuffer.size});
   ref.packetBuffer.clear();
 }
 if(ref.finalExpectedSeq!==null&&ref.nextSeq!==ref.finalExpectedSeq&&unsignedAhead(ref.finalExpectedSeq,ref.nextSeq)){
   const missing=(ref.finalExpectedSeq-ref.nextSeq)>>>0;
   ref.diagnostics.push({kind:'UNRECOVERED_TRAILING_SEQ_AT_STOP',expected:ref.nextSeq,end:ref.finalExpectedSeq,missing});
   ref.gaps++;ref.missingSamples+=missing;
   ref.nextSeq=ref.finalExpectedSeq;
 }
}
async function finalizeStop(ref){
 if(ref.stopFinalizePromise)return ref.stopFinalizePromise;
 ref.stopFinalizePromise=(async()=>{
   if(timer){clearInterval(timer);timer=null;}
   ref.stopResolver?.('STOP_ABORTED');ref.stopResolver=null;
   stopDrainBounded(ref);
   flushPackets(ref);
   ref.endedAt=new Date().toISOString();ref.state='stopped';
   saveManifest(ref);
   // Most writes finish quickly; do not claim success on an IndexedDB error.
   // On a stalled write show a warning and allow the user to recover/export.
   const saved=await Promise.race([
     ref.writeTail.then(()=>true,()=>false),
     delayMs(4500).then(()=>false)
   ]);
   if(s!==ref)return;
   if(ref.storageError){say('STOP: błąd zapisu lokalnego. Zachowaj diagnostykę.','error');}
   else if(!saved){say('Sesja zakończona; zapisy IndexedDB nadal oczekują. Sprawdź eksport i odzyskiwanie.','warn');}
   else if(ref.emergencyStop){say('AWARYJNY STOP: zamknięto sesję i rozłączono BLE. Eksport jest dostępny.','warn');}
   else if(ref.stopAckTimedOut){say('Zapis zakończony, ale brak STOP ACK z Arduino. BLE rozłączono dla bezpieczeństwa; połącz ponownie przed kolejną próbą.','warn');}
   else say('Sesja zatrzymana i utrwalona lokalnie. Możesz wyeksportować ZIP.','ok');
   render(true);
 })();
 return ref.stopFinalizePromise;
}
async function emergencyStop(ref){
 if(!ref||ref.state!=='stopping'||ref.emergencyStop)return;
 ref.emergencyStop=true;
 ref.diagnostics.push({kind:'EMERGENCY_STOP_PRESSED',at:new Date().toISOString()});
 bleTransport?.cancelSessionReplayCommands?.();
 // Explicit emergency action: break a potentially stuck GATT operation.
 try{if(bleTransport?.device?.gatt?.connected)bleTransport.device.gatt.disconnect();}
 catch(e){ref.diagnostics.push({kind:'EMERGENCY_DISCONNECT_ERROR',error:String(e)});}
 await finalizeStop(ref);
}
async function stop(reason='USER_STOP'){
 const ref=s;if(!ref)return;
 if(ref.state==='stopping'){await emergencyStop(ref);return;}
 if(ref.state!=='recording')return;
 ref.state='stopping';ref.stopReason=reason;
 ref.stopButtonPressedAt=new Date().toISOString();
 ref.stopRequestedPerf=performance.now();ref.stopFrozenSamples=ref.samples;
 ref.stopFrozenTime=ref.mode==='ble400'
    ?Math.max(0,ref.stopRequestedPerf-(ref.firstPacketPerf??ref.perfStart))
    :ref.lastSampleTime;
 if(timer){clearInterval(timer);timer=null;}
 if(ref.wakeLock){void ref.wakeLock.release().catch(()=>{});ref.wakeLock=null;}
 if(ref.mode==='ble400'){
   bleTransport?.cancelSessionReplayCommands?.();
   ref.diagnostics.push({kind:'STOP_BUTTON',reason,at:ref.stopButtonPressedAt,receivedSamples:ref.samples});
   say('STOP przyjęty. Zatrzymuję Arduino i domykam zapis. Jeśli trwa to zbyt długo, naciśnij AWARYJNY STOP.','warn');
   render(true);
   try{
     if(bleTransport?.running){
       for(let attempt=0;attempt<2&&!ref.stopAckSeen&&!ref.emergencyStop;attempt++){
         const answer=await stopFirmwareAttempt(ref);
         if(answer==='ACK_OK')break;
         ref.diagnostics.push({kind:'STOP_ATTEMPT',attempt:attempt+1,result:answer});
       }
       if(!ref.stopAckSeen&&!ref.emergencyStop){
         ref.stopAckTimedOut=true;
         ref.diagnostics.push({kind:'STOP_ACK_TIMEOUT'});
         // Disconnect forces Arduino's BLE connection loop to exit and STOP RAW.
         try{if(bleTransport?.device?.gatt?.connected)bleTransport.device.gatt.disconnect();}
         catch(e){ref.diagnostics.push({kind:'STOP_DISCONNECT_ERROR',error:String(e)});}
       }
       if(ref.stopAckSeen&&!ref.emergencyStop){
         const deadline=performance.now()+STOP_SETTLE_MS;
         while(performance.now()<deadline&&!ref.emergencyStop){
           drainOrdered(ref);
           if(!ref.packetBuffer.size&&(ref.finalExpectedSeq===null||ref.nextSeq===ref.finalExpectedSeq))break;
           await delayMs(100);
         }
       }
     }
   }catch(e){ref.diagnostics.push({kind:'BLE_STOP_ERROR',error:String(e)});}
   if(!ref.stopFinalizePromise)await finalizeStop(ref);
 }else{
   ref.endedAt=new Date().toISOString();ref.state='stopped';
   say('Zakończono REPLAY. Możesz wyeksportować ZIP.','ok');render(true);
 }
}
function parseCSV(src,name){const lines=src.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.length>MAX_REPLAY+1)throw Error('Za dużo próbek w REPLAY');
 const heads=lines[0].split(',');const col=(...k)=>k.map(x=>heads.indexOf(x)).find(i=>i>=0);
 const m={seq:col('sequence','SEQ'),time:col('time_ms','time_ms_nominal')};for(const a of AXES)m[a]=col(a,a+(a.startsWith('A')?'_g':'_dps'));
 if(m.seq===undefined||AXES.some(x=>m[x]===undefined))throw Error('CSV wymaga sequence i 6 kanałów');
 const rows=[];let base=null;for(const line of lines.slice(1)){if(!line.trim())continue;const v=line.split(','),seq=Number(v[m.seq]);if(!Number.isSafeInteger(seq))throw Error('Zły SEQ');
 const raw={sequence:seq};for(const axis of AXES)raw[axis]=Number(v[m[axis]]);if(AXES.some(k=>!Number.isFinite(raw[k])))throw Error('Nieprawidłowe RAW');
 if(base===null)base=seq;raw.time_ms=((seq-base)>>>0)*PERIOD_MS;rows.push(raw);}
 return {name,samples:rows};}
function chooseFile(){const f=ui.import.files?.[0];if(!f)return;if(f.size>MAX_IMPORT_BYTES){say('CSV >16 MB; zmniejsz test.','error');return;}
 f.text().then(t=>{source=parseCSV(t,f.name);ui.file.textContent=`${f.name}: ${source.samples.length} próbek RAW400`;say('Wczytano — wybierz REPLAY i START.','ok');controls();}).catch(e=>say('CSV: '+e.message,'error')).finally(()=>{ui.import.value='';});}
function correctLabel(mark,field,value){if(!s||s.state==='recording')return;
 if(field==='event'){const e=s.events.find(x=>x.id===value);mark.linkedEventId=e?.id||null;mark.eventTimeMs=e?.time_ms??null;mark.eventSequence=e?.sequence??null;mark.status=e?'LINKED':'UNLINKED';}
 else{const t=Number(value);if(!Number.isFinite(t)||t<0||t>s.lastSampleTime)return;mark.eventTimeMs=t;mark.eventSequence=s.firstSeq!==null?(s.firstSeq+Math.round(t/2.5))>>>0:null;mark.status='ALIGNED';mark.linkedEventId=null;}
 if(s.mode==='ble400')saveManifest(s);render(true);}
function showEvents(){ui.events.replaceChildren();if(!s?.events?.length){ui.events.append(text('p','v64-empty','Brak wykryć AUTO'));return;}
 for(const e of s.events.slice(-14).reverse()){ui.events.append(text('div','v64-event '+(e.type.startsWith('GESTURE')?'v64-gesture-event':'v64-candidate'),`${clock(e.time_ms)} • ${e.type} • SEQ ${e.sequence}`));}}
function showMarks(){ui.marks.replaceChildren();if(!s?.manual?.length){ui.marks.append(text('p','v64-empty','Brak oznaczeń ręcznych'));return;}
 for(const mark of s.manual.slice(-14).reverse()){
  const el=text('div','v64-label-row',''),head=text('div','v64-label-head',`${clock(mark.pressStreamTimeMs)} • ${mark.type} • ${mark.status}`);el.append(head);
  if(s.state!=='recording'&&s.state!=='stopping'){
   const controls=text('div','v64-label-edit',''),select=document.createElement('select');select.setAttribute('aria-label','Połącz znacznik z AUTO');select.add(new Option('Bez powiązania',''));
   for(const e of s.events.filter(x=>Math.abs(x.time_ms-mark.nearestReceivedRawTimeMs)<2500))select.add(new Option(`${clock(e.time_ms)} • ${e.type}`,e.id));
   select.value=mark.linkedEventId||'';select.onchange=()=>correctLabel(mark,'event',select.value);
   const inp=document.createElement('input');inp.type='number';inp.min=0;inp.step=2.5;inp.max=s.lastSampleTime;inp.placeholder='czas RAW ms';inp.value=mark.eventTimeMs??'';inp.onchange=()=>correctLabel(mark,'time',inp.value);
   controls.append(select,inp);el.append(controls);
  }ui.marks.append(el);
 }}
function render(force=false){const ref=s;ui.clock.textContent=ref?clock(ref.state==='stopping'?ref.stopFrozenTime:ref.state==='recording'&&ref.mode==='replay'?ref.lastSampleTime:ref.state==='recording'?performance.now()-(ref.mode==='ble400'&&ref.firstPacketPerf!==null?ref.firstPacketPerf:ref.perfStart):ref.lastSampleTime):'00:00.000';
 ui.samples.textContent=ref?(ref.state==='stopping'?ref.stopFrozenSamples:ref.samples).toLocaleString('pl-PL'):'0';ui.integrity.textContent=ref?`SEQ gaps: ${ref.gaps} • missing: ${ref.missingSamples} • recovered: ${ref.recoveredFrames||0} • pending: ${ref.packetBuffer?.size||0} • CRC: ${ref.crcErrors} • BLE: ${ref.frames} frames`:'—';
 ui.ac.textContent=ref?ref.events.filter(e=>e.type==='CONTACT_CANDIDATE').length:0;ui.ag.textContent=ref?ref.events.filter(e=>e.type.startsWith('GESTURE')).length:0;
 ui.mc.textContent=ref?ref.manual.filter(e=>e.type==='CONTACT').length:0;ui.mg.textContent=ref?ref.manual.filter(e=>e.type==='GEST').length:0;
 ui.bar.value=ref?.mode==='replay'&&source?(100*replayIndex/source.samples.length):0;
 ui.notes.textContent=ref?.mode==='ble400'?`LIVE RAW400 • retransmisja: ${ref.retransmissionEnabled?'ON':'OFF'} • ${ref.samples} próbek • odzyskane ramki: ${ref.recoveredFrames||0} • zapis IndexedDB: ${ref.parts} fragmentów. Kontakt i DOUBLE TAP są hipotezami; czas dotknięcia przycisku NIE jest czasem uderzenia.`:'Detektory działają na pełnych danych 400 Hz. Wyniki AUTO pozostają niezależne od etykiet ręcznych.';
 if(force||ref?.events?.length!==Number(ui.events.dataset.count)){showEvents();ui.events.dataset.count=String(ref?.events?.length||0);}
 if(force||ref?.manual?.length!==Number(ui.marks.dataset.count)){showMarks();ui.marks.dataset.count=String(ref?.manual?.length||0);}controls();}
// A compact ZIP writer supporting binary Uint8Array payloads (no external CDN).
function zip(files){
 const enc=new TextEncoder(), parts=[], central=[];let offset=0;
 for(const [filename,content] of files){
  const name=enc.encode(filename), bytes=typeof content==='string'?enc.encode(content):content;
  if(name.length>65535||bytes.length>0xffffffff)throw Error('ZIP32 file limit');
  const crc=contactCRC32(bytes), flags=0x0800;
  const local=new Uint8Array([...contactU32(0x04034b50),...contactU16(20),...contactU16(flags),...contactU16(0),...contactU16(0),...contactU16(0),...contactU32(crc),...contactU32(bytes.length),...contactU32(bytes.length),...contactU16(name.length),...contactU16(0)]);
  parts.push(local,name,bytes);
  const head=new Uint8Array([...contactU32(0x02014b50),...contactU16(20),...contactU16(20),...contactU16(flags),...contactU16(0),...contactU16(0),...contactU16(0),...contactU32(crc),...contactU32(bytes.length),...contactU32(bytes.length),...contactU16(name.length),...contactU16(0),...contactU16(0),...contactU16(0),...contactU16(0),...contactU32(0),...contactU32(offset)]);
  central.push(head,name);offset+=local.length+name.length+bytes.length;
 }
 const size=central.reduce((n,x)=>n+x.length,0);
 if(offset+size>0xffffffff)throw Error('ZIP32 archive limit');
 const end=new Uint8Array([...contactU32(0x06054b50),...contactU16(0),...contactU16(0),...contactU16(files.length),...contactU16(files.length),...contactU32(size),...contactU32(offset),...contactU16(0)]);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}
async function exportSession(){if(!s||s.state==='recording'||s.state==='stopping')return;const ref=s;ui.exp.disabled=true;
 try{if(ref.writeTail)await ref.writeTail;let raw=null,meta=smallManifest(ref);
  const files=[['session.json',JSON.stringify(meta,null,2)+'\n'],['auto_events.json',JSON.stringify(ref.events,null,2)+'\n'],['manual_labels.json',JSON.stringify(ref.manual,null,2)+'\n'],['manual_labels.csv',csv([['id','type','pressedAt','pressStreamTimeMs','nearestReceivedSequence','nearestReceivedRawTimeMs','eventTimeMs','eventSequence','linkedEventId','status'],...ref.manual.map(m=>[m.id,m.type,m.pressedAt,m.pressStreamTimeMs,m.nearestReceivedSequence,m.nearestReceivedRawTimeMs,m.eventTimeMs,m.eventSequence,m.linkedEventId,m.status])])],['README.txt','GAZELA V65.3 TRANSPORT ISOLATION: Sequenced live RAW frames sorted by SEQ in export; R<SEQ> retransmission is OFF by default (session.json retransmissionEnabled records the actual setting); gaps refer to missing samples. LIVE RAW 400 Hz packets; each frame has magic GZ, version, N, SEQ, nominal time, 6x int16 per sample, CRC16. Full session raw is concatenated binary GATT frames. No claim of BMI270 hardware timestamps. Detector predictions are hypotheses, NOT confirmed contact/gesture. Manual press latency is unknown. Check missing SEQ / CRC / storage errors.\n']];
  if(ref.mode==='ble400'){const chunks=(await dbAll('chunks')).filter(x=>x.sessionId===ref.id).sort((a,b)=>a.part-b.part);
    const buffers=chunks.flatMap(x=>x.packets).sort((a,b)=>{const x=new DataView(a.buffer,a.byteOffset,a.byteLength).getUint32(4,true),y=new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(4,true);return x-y;});const bytes=buffers.reduce((n,x)=>n+x.length,0);raw=new Uint8Array(bytes);let at=0;for(const b of buffers){raw.set(b,at);at+=b.length;}
    files.push(['raw_400hz_ble_frames.bin',raw]);meta.savedParts=chunks.length;meta.savedBytes=bytes;
  }else{files.push(['replay_raw_400hz.csv',csv([['index','sequence','time_ms','AX_g','AY_g','AZ_g','GX_dps','GY_dps','GZ_dps'],...ref.raw.map(p=>[p.index,p.sequence,p.time_ms,...AXES.map(k=>p[k])])])]);}
  files[0][1]=JSON.stringify(meta,null,2)+'\n';const blob=zip(files);contactSaveBlob(`GAZELA_V65_SESSION_${ref.id}.zip`,blob);say('Eksport ZIP utworzony. Zachowaj kopię poza przeglądarką.','ok');
 }catch(e){say('BŁĄD EKSPORTU: '+e.message,'error');}finally{controls();}}
async function recover(){if(s?.state==='recording')return;
 try{const items=(await dbAll('sessions')).filter(x=>x.mode==='ble400').sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
  if(!items.length){say('Brak lokalnych sesji do odzyskania.','warn');return;}
  const item=items[0];s=newSession('ble400');Object.assign(s,item,{raw:[],pending:[],history:[],candidates:[],gesture:new GazelaGestureStreamRecognizerV1(),writeTail:Promise.resolve(),state:'stopped'});
  // session.id restored; keep local original record unchanged until export
  say(`Odzyskano sesję ${s.id} (${s.samples} próbek). Możesz wyeksportować zapis.`,'ok');render(true);
 }catch(e){say('Odzysk: '+e.message,'error');}}
async function references(){try{await window.GazelaReferenceLibrary?.ready();const list=window.GazelaReferenceLibrary?.list()||[];ui.reference.replaceChildren(new Option('DOUBLE TAP — reguła czasowa',''));
  for(const item of list)ui.reference.add(new Option(`${item.name} (${item.recordCount})`,item.id));ui.referenceStatus.textContent=`Profile dostępne: ${list.length}. Aktualnie dopasowanie orientacyjnie niezależne, NIE zwalidowany podpis.`;}
 catch(e){ui.referenceStatus.textContent='Błąd biblioteki: '+e.message;}}
ui.start.onclick=()=>void start();ui.stop.onclick=()=>void stop();ui.exp.onclick=()=>void exportSession();if(ui.recover)ui.recover.onclick=()=>void recover();
ui.markC.onclick=()=>pressLabel('CONTACT');ui.markG.onclick=()=>pressLabel('GEST');ui.undo.onclick=()=>{if(s?.manual?.length){s.manual.pop();if(s.mode==='ble400')saveManifest(s);render(true);}};
ui.import.onchange=chooseFile;ui.mode.onchange=()=>{say(ui.mode.value==='ble400'?'LIVE RAW 400 Hz — zalecany firmware V29.2.2, BLE RAW characteristic 0004.':'REPLAY RAW400 z CSV','info');controls();};
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&s?.state==='recording'){void stop('PAGE_HIDDEN');say('Aplikacja ukryta. Zatrzymano sesję, by nie ukrywać braków pomiaru.','warn');}});
window.GazelaSessionV65=Object.freeze({version:'V65.3_TRANSPORT_ISOLATION',onRawPacket,onStreamMessage,onConnectionChanged:controls,onStreamStopped:msg=>{if(s&&s.mode==='ble400'&&s.state==='stopping'){s.firmwareStop=msg;s.stopAckSeen=true;const fields=msg.split(',');const end=Number(fields[9]);if(Number.isSafeInteger(end)&&end>0)s.finalExpectedSeq=end;s.diagnostics.push({kind:'FIRMWARE_STOP_STATUS',message:msg});s.stopResolver?.('ACK_OK');}},onBLEDisconnect:()=>{if(s?.mode==='ble400'&&s.state==='recording')void stop('BLE_DISCONNECTED');},state:()=>s?{state:s.state,mode:s.mode,samples:s.samples,gaps:s.gaps,missing:s.missingSamples,crc:s.crcErrors,events:s.events.length,manual:s.manual.length}:null});
if(ui.retransmission)ui.retransmission.checked=false; // Enforce OFF even if Chrome restores form state after reload.
void references();say('V65.3: transport RAW400; retransmisja OFF (domyślnie). STOP i eksport ZIP zachowane.','info');render(true);
})();
