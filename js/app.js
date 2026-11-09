// app.js — GAZELA SENSOR V50 USB RECONNECT RECOVERY

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

let selectedTransport = "ble";

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

        this.controlService = null;

        this.commandCharacteristic = null;

        this.decoder =

            new TextDecoder();

        this.notificationCount = 0;

        this.boundNotificationHandler =

            this.handleNotification.bind(this);

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

        this.controlService = null;

        this.commandCharacteristic = null;

    }

    handleDisconnected() {

        // The browser can deliver more than one disconnect notification

        // while a GATT connection is being torn down. Handle this transport

        // instance only once.

        if (this.disconnectHandled) {

            return;

        }

        this.disconnectHandled = true;

        this.running = false;

        this.rxBuffer = "";

        addSerialLine(

            "BLE device disconnected.",

            "serial-error"

        );

        // ----------------------------------------------------

        // CLEAN UP THIS BLE TRANSPORT INSTANCE

        // ----------------------------------------------------

        //

        // When the peripheral disconnects by itself, disconnect() is not

        // called by the application. Therefore the old event listeners

        // must be removed here as well. Otherwise an old transport object

        // can remain subscribed to the same BluetoothDevice and react to

        // later disconnects.

        if (this.liveCharacteristic) {

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

        this.server = null;

        this.sensorService = null;

        this.liveCharacteristic = null;

        this.controlService = null;

        this.commandCharacteristic = null;

        if (

            sensorTransport === this

        ) {

            sensorTransport = null;

            transportType = null;

            stopHeartbeatMonitor();

            measuring = false;

            sensorReady = false;

            measurementCommandSent =

                false;

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

async function createSensorTransport() {

    // USB: PC -> Web Serial | Android -> WebUSB

    if (selectedTransport === "usb") {

        const android = isAndroidDevice();

        if (android) {

            if (!("usb" in navigator)) {

                throw new Error("Android: WebUSB nie jest dostępne w tej przeglądarce.");

            }

            addSerialLine("V43: USB transport = WebUSB (Android)", "serial-info");

            return new WebUSBTransport(

                line => routeSensorMessage("usb", line),

                (transport, reason) => handleUnexpectedTransportEnd(transport, reason)

            );

        }

        if ("serial" in navigator) {

            addSerialLine("V43: USB transport = Web Serial (PC)", "serial-info");

            return new WebSerialTransport(

                line => routeSensorMessage("usb", line),

                (transport, reason) => handleUnexpectedTransportEnd(transport, reason)

            );

        }

        if ("usb" in navigator) {

            addSerialLine("V43: USB transport = WebUSB fallback (PC)", "serial-info");

            return new WebUSBTransport(

                line => routeSensorMessage("usb", line),

                (transport, reason) => handleUnexpectedTransportEnd(transport, reason)

            );

        }

        throw new Error("USB: brak Web Serial oraz WebUSB.");

    }

    // BLE: PC + Android -> Web Bluetooth

    if (selectedTransport === "ble") {

        if ("bluetooth" in navigator) {

            addSerialLine("V43: BLE transport = Web Bluetooth", "serial-info");

            return new WebBluetoothTransport(line => routeSensorMessage("ble", line));

        }

        throw new Error("Web Bluetooth nie jest dostępny w tej przeglądarce.");

    }

    throw new Error("Nieznany transport: " + selectedTransport);

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

        sensorTransport &&

        selectedTransport ===

            "ble"

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

    // ====================================================

    // SERIAL MONITOR

    // ====================================================

    // Classify and route the message using its actual transport source.

    routeServiceDiagnosticLine(line, source, messageType);

    if (!isSensorDataLine(line)) {

        addSerialLine(line);

    }

    // USB is a diagnostics-only, read-only channel. Its messages must never

    // alter BLE training state or feed USER MODE sensor/battery widgets.

    if (source === "usb") {

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

    // SERVICE USB is strictly read-only. No command is sent to the sensor.

    if (selectedTransport === "usb") {

        throw new Error(

            "SERVICE MODE USB jest tylko do odczytu. Sterowanie sensorem odbywa się wyłącznie przez firmware/BLE."

        );

    }

    if (!sensorTransport) {

        throw new Error(

            "Sensor nie jest podłączony."

        );

    }

    await sensorTransport.send(

        command

    );

    addSerialLine(

        "> " + command,

        "serial-command"

    );

}

// ========================================================

// START LIVE MODE

// ========================================================

async function startLiveMode() {

    if (!sensorTransport) {

        return;

    }

    if (selectedTransport !== "ble") {

        addSerialLine(

            "V48: LIVE start is disabled over USB; USB is service-only.",

            "serial-info"

        );

        return;

    }

    try {

        await sendCommand(

            "L"

        );

        measuring = false;

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

            startButton.disabled =

                false;

        }

        if (stopButton) {

            stopButton.disabled =

                true;

        }

    }

    catch (error) {

        console.error(

            "LIVE error:",

            error

        );

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

        throw error;

    }

}

// ========================================================

// V50 — UNEXPECTED TRANSPORT END RECOVERY

// ========================================================

async function handleUnexpectedTransportEnd(transport, reason) {

    // Ignore stale transports and intentional/manual disconnects.

    if (!transport || sensorTransport !== transport) {

        return;

    }

    addSerialLine(

        "V50: unexpected transport end detected (" + reason + "). Cleaning connection state.",

        "serial-error"

    );

    // readTask has already settled before this callback is invoked,

    // so disconnectSensor() can safely release the port/device.

    await disconnectSensor();

    if (serviceConnectionStatus && isServiceModeOpen() && selectedTransport === "usb") {

        serviceConnectionStatus.textContent =

            "USB zostało rozłączone lub przestało przesyłać dane. Możesz ponownie nacisnąć CONNECT USB — odświeżanie strony nie jest wymagane.";

    }

    addSerialLine(

        "V50: transport state reset complete. USB can be reconnected.",

        "serial-info"

    );

}

// ========================================================

// CONNECT SENSOR

// ========================================================

async function connectSensor() {

    if (selectedTransport === "usb" && !isServiceModeOpen()) {

        addSerialLine("USB CONNECT BLOCKED: SERVICE MODE is closed.", "serial-error");

        return;

    }

    if (sensorTransport) {

        return;

    }

    sensorReady = false;

    lastLiveFrameSequence = null;

    lastLiveFifoSequence = null;

    liveSequenceGapCount = 0;

    fifoSequenceGapCount = 0;

    liveDetectedDuringInitialConnect =

        false;

    waitingForInitialReady =

        true;

    returnToLiveAfterReady =

        false;

    measurementCommandSent =

        false;

    try {

        sensorTransport =

            await createSensorTransport();

        transportType =

            sensorTransport.name;

        setTransportStatus(

            "Transport: " +

            transportType

        );

        // ------------------------------------------------

        // CONNECT

        // ------------------------------------------------

        const connectingTransport = sensorTransport;

        await connectingTransport.connect();

        if (sensorTransport !== connectingTransport) {

            return;

        }

        // ------------------------------------------------

        // UI

        // ------------------------------------------------

        if (connectButton) {

            connectButton.disabled =

                true;

        }

        if (disconnectButton) {

            disconnectButton.disabled =

                false;

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

        if (selectedTransport === "ble") {

            startHeartbeatMonitor();

        } else {

            stopHeartbeatMonitor();

        }

        // ------------------------------------------------

        // BLE

        // ------------------------------------------------

        if (

            selectedTransport ===

            "ble"

        ) {

            sensorReady =

                true;

            waitingForInitialReady =

                false;

            await startLiveMode();

            return;

        }

        // ------------------------------------------------

        // USB — SERVICE / DIAGNOSTICS ONLY (V48)

        if (selectedTransport === "usb") {

            waitingForInitialReady = false;

            sensorReady = false;

            if (startButton) {

                startButton.disabled = true;

            }

            if (stopButton) {

                stopButton.disabled = true;

            }

            setStatus(

                "USB service connection",

                "connected"

            );

            if (measurementStatus) {

                measurementStatus.textContent =

                    "USB connected in service mode. Training measurements are available through BLE only.";

                measurementStatus.className =

                    "measurement-status";

            }

            addSerialLine(

                "V48: USB connected as diagnostics-only transport. No commands are sent.",

                "serial-info"

            );

            routeServiceDiagnosticLine("USB CONNECTED: " + transportType + " (115200 baud, READ ONLY)", "usb");

        }

    }

    catch (error) {

        console.error(

            "Connection error:",

            error

        );

        if (sensorTransport) {

            try {

                await sensorTransport

                    .disconnect();

            }

            catch (disconnectError) {

                console.warn(

                    disconnectError

                );

            }

        }

        sensorTransport = null;

        transportType = null;

        sensorReady = false;

        waitingForInitialReady =

            false;

        returnToLiveAfterReady =

            false;

        measurementCommandSent =

            false;

        stopHeartbeatMonitor();

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

            connectButton.disabled =

                false;

        }

        if (disconnectButton) {

            disconnectButton.disabled =

                true;

        }

        if (startButton) {

            startButton.disabled =

                true;

        }

        if (stopButton) {

            stopButton.disabled =

                true;

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

    // V48 TRANSPORT POLICY

    if (selectedTransport !== "ble") {

        setStatus(

            "Training requires BLE",

            "error"

        );

        if (measurementStatus) {

            measurementStatus.textContent =

                "USB is reserved for service diagnostics. Connect through BLE to record movements.";

            measurementStatus.className =

                "measurement-status";

        }

        addSerialLine(

            "V48: measurement blocked because active transport is USB. Use BLE for S.",

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

    if (!sensorTransport) {

        return;

    }

    if (selectedTransport !== "ble") {

        if (measurementStatus) {

            measurementStatus.textContent =

                "USB is service-only. Training STOP is available through BLE.";

        }

        addSerialLine(

            "V48: STOP command blocked over USB.",

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

async function disconnectSensor() {

    stopHeartbeatMonitor();

    const transport =

        sensorTransport;

    sensorTransport = null;

    transportType = null;

    sensorReady = false;

    waitingForInitialReady =

        false;

    returnToLiveAfterReady =

        false;

    measurementCommandSent =

        false;

    try {

        if (transport) {

            // ------------------------------------------------

            // V39 WEBUSB DISCONNECT

            // ------------------------------------------------

            //

            // Do NOT send Q here.

            // V39 WebUSB disconnect test.

            // ------------------------------------------------

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

            connectButton.disabled =

                false;

        }

        if (disconnectButton) {

            disconnectButton.disabled =

                true;

        }

        if (startButton) {

            startButton.disabled =

                true;

        }

        if (stopButton) {

            stopButton.disabled =

                true;

        }

        setStatus(

            "Sensor not connected",

            "neutral"

        );

        setTransportStatus(

            "Transport: not connected"

        );

        if (serviceConnectionStatus && isServiceModeOpen()) {

            serviceConnectionStatus.textContent = selectedTransport === "usb"

                ? "USB rozłączone. Możesz ponownie połączyć port z przycisku CONNECT USB."

                : "BLE rozłączone. Możesz teraz połączyć USB w SERVICE MODE.";

        }

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

// SELECT USB — SERVICE / DIAGNOSTICS

// ========================================================

function selectUSBTransport() {

    if (!isServiceModeOpen()) {

        addSerialLine("USB transport is locked until SERVICE MODE is opened.", "serial-error");

        return;

    }

    if (sensorTransport) {

        return;

    }

    selectedTransport =

        "usb";

    if (usbButton) {

        usbButton.classList.add(

            "active"

        );

    }

    if (bleButton) {

        bleButton.classList.remove(

            "active"

        );

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

// SELECT BLE — ATHLETE / TRAINING

// ========================================================

function selectBLETransport() {

    if (sensorTransport) {

        return;

    }

    selectedTransport =

        "ble";

    if (bleButton) {

        bleButton.classList.add(

            "active"

        );

    }

    if (usbButton) {

        usbButton.classList.remove(

            "active"

        );

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

// BUTTON EVENTS — USER BLE / SERVICE USB

// USB selector exists only inside the hidden SERVICE MODE panel.

if (usbButton) {

    usbButton.addEventListener("click", async () => {

        if (!isServiceModeOpen()) return;

        if (sensorTransport && selectedTransport === "ble") {

            if (serviceConnectionStatus) serviceConnectionStatus.textContent =

                "Aktywne jest połączenie BLE. Najpierw rozłącz BLE przyciskiem Disconnect, a następnie wybierz CONNECT USB.";

            return;

        }

        if (sensorTransport && selectedTransport === "usb") {

            if (serviceConnectionStatus) serviceConnectionStatus.textContent = "USB jest już połączone. Odbiór diagnostyki jest aktywny.";

            return;

        }

        selectUSBTransport();

        if (serviceConnectionStatus) serviceConnectionStatus.textContent = "Otwieranie wyboru portu USB. Wybierz port Arduino.";

        await connectSensor();

        if (serviceConnectionStatus) serviceConnectionStatus.textContent = sensorTransport && selectedTransport === "usb"

            ? "USB aktywne — transmisja diagnostyczna jest odbierana. Kanał pozostaje tylko do odczytu."

            : "Nie udało się połączyć USB. Sprawdź Serial Monitor i spróbuj ponownie.";

    });

}

if (bleButton) {

    bleButton.addEventListener("click", () => {

        if (sensorTransport && selectedTransport === "usb") {

            addSerialLine("Rozłącz USB w SERVICE MODE przed przełączeniem na BLE.", "serial-error");

            return;

        }

        selectBLETransport();

    });

}

if (serviceModeToggle && serviceModeContent) {

    serviceModeToggle.addEventListener("click", async () => {

        const isOpen = serviceModeToggle.getAttribute("aria-expanded") === "true";

        const description = serviceModeToggle.querySelector(".service-toggle-description");

        if (isOpen) {

            if (sensorTransport && selectedTransport === "usb") await disconnectSensor();

            serviceModeToggle.setAttribute("aria-expanded", "false");

            serviceModeContent.hidden = true;

            if (description) description.textContent = "Otwórz moduły diagnostyczne i uzyskaj dostęp do USB.";

            return;

        }

        serviceModeToggle.setAttribute("aria-expanded", "true");

        serviceModeContent.hidden = false;

        if (description) description.textContent = "Moduły diagnostyczne są dostępne. Połącz USB, aby odczytać dane serwisowe.";

        if (sensorTransport && selectedTransport === "ble") {

            if (serviceConnectionStatus) serviceConnectionStatus.textContent =

                "BLE USER MODE jest aktywny. Aby przejść na USB, najpierw rozłącz BLE przyciskiem Disconnect.";

        } else if (sensorTransport && selectedTransport === "usb") {

            if (serviceConnectionStatus) serviceConnectionStatus.textContent = "USB jest już połączone — odbiór diagnostyki trwa.";

        } else if (serviceConnectionStatus) {

            serviceConnectionStatus.textContent = "SERVICE MODE aktywny. Naciśnij CONNECT USB, aby wybrać port i rozpocząć odbiór diagnostyki.";

        }

    });

}

if (connectButton) {

    connectButton.addEventListener("click", async () => {

        if (sensorTransport && selectedTransport === "usb") {

            addSerialLine("Rozłącz USB w SERVICE MODE przed połączeniem BLE.", "serial-error");

            return;

        }

        selectBLETransport();

        await connectSensor();

    });

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

// INITIAL TRANSPORT

// ========================================================

selectUSBTransport();

// ========================================================

// INITIAL STATUS

// ========================================================

setStatus(

    "Sensor not connected",

    "neutral"

);

setTransportStatus(

    "Transport: USB"

);

resetLiveValues();

resetBatteryValues();

// ========================================================

// DEBUG ACCESS

// ========================================================

window.gazelaSensor = {

    getTransport: () =>

        sensorTransport,

    getTransportType: () =>

        transportType,

    getSelectedTransport: () =>

        selectedTransport,

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

    gestureElements.record.disabled = gestureRecording || !sensorTransport || selectedTransport !== "usb" && selectedTransport !== "ble";

  }

  if (gestureElements.stop) gestureElements.stop.disabled = !gestureRecording;

  if (gestureElements.save) gestureElements.save.disabled = gestureRecording || !gestureCompletedRecording || gestureCompletedRecording.length < 2;

  if (gestureElements.compare) {

    gestureElements.compare.disabled = gestureRecording || !gestureReference || !gestureCompletedRecording;

  }

  if (gestureElements.clear) gestureElements.clear.disabled = gestureRecording;

  if (!gestureRecording && !sensorTransport) {

    gestureSetBadge("Waiting for LIVE");

  } else if (!gestureRecording && sensorTransport) {

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

  if (!sensorTransport) {

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
