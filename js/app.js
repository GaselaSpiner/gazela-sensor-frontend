// GAZELA SPINER SENSOR — SENSOR LAB
// app.js — V46 WEBUSB DETECTION DIAGNOSTIC + TRANSPORT LAYER + USB SERIAL/WEBUSB + BLE
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
// V46 DIAGNOSTIC:
// 1. Shows exact USB RX bytes before line parsing.
// 2. Web Serial and WebUSB use the same bounded RAW RX diagnostic.
// 3. No commands, firmware protocol, BLE logic or measurement logic changed.
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
 
let selectedTransport = "usb";
 
let measuring = false;
 
let currentMovement = 0;
 
let sessionStartTime = null;
 
let sessionEndTime = null;
 
let sampleCount = 0;
 
 
// ========================================================
// SENSOR READY STATE
// ========================================================
 
let sensorReady = false;
 
let waitingForInitialReady = false;
 
let returnToLiveAfterReady = false;
 
let measurementCommandSent = false;
 
 
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
 
        addSerialLine(
            "V43: transport disconnect START",
            "serial-info"
        );
 
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
 
    constructor(onLine) {
 
        super(onLine);
 
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
        this.v45RxChunkCount = 0;
 
        addSerialLine(
            "V46: Web Serial readLoop START",
            "serial-info"
        );
 
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
 
        if (
            !this.port ||
            !this.port.writable
        ) {
 
            throw new Error(
                "Web Serial nie jest gotowy do wysyłania."
            );
        }
 
        addSerialLine(
            "V43: USB TX " + command,
            "serial-info"
        );
 
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
            this.v45RxChunkCount = 0;
 
            addSerialLine(
                "V46: WebUSB readLoop START",
                "serial-info"
            );
 
            this.readTask =
                this.readLoop();
 
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
 
        addSerialLine(
            "V40 TEST: USB TX " +
            command,
            "serial-info"
        );
 
        await this.device.transferOut(
            1,
            data
        );
    }
 
    async cleanupAfterConnectError() {
 
        this.running = false;
 
        if (this.device) {
 
            if (this.interface1Claimed) {
 
                try {
 
                    await this.device
                        .releaseInterface(1);
                }
                catch (error) {
 
                    console.warn(
                        "V39 releaseInterface(1):",
                        error
                    );
                }
 
                this.interface1Claimed =
                    false;
            }
 
            if (this.interface0Claimed) {
 
                try {
 
                    await this.device
                        .releaseInterface(0);
                }
                catch (error) {
 
                    console.warn(
                        "V39 releaseInterface(0):",
                        error
                    );
                }
 
                this.interface0Claimed =
                    false;
            }
 
            try {
 
                await this.device.close();
 
            }
            catch (error) {
 
                console.warn(
                    "V39 device.close():",
                    error
                );
            }
        }
 
        this.device = null;
        this.readTask = null;
        this.buffer = "";
    }
 
    async disconnect() {
 
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
            "BLE: start notifications...",
            "serial-info"
        );
 
 
        await this.liveCharacteristic
            .startNotifications();
 
 
        addSerialLine(
            "BLE: notifications OK",
            "serial-info"
        );
 
 
        this.liveCharacteristic
            .addEventListener(
                "characteristicvaluechanged",
                this.boundNotificationHandler
            );
 
 
        this.running = true;
 
 
        addSerialLine(
            "BLE: CONNECT COMPLETE",
            "serial-info"
        );
    }
 
    handleNotification(event) {
 
        try {
 
            const value =
                event.target.value;
 
            const text =
                this.decoder.decode(
                    value
                );
 
            const lines =
                text.split(
                    /\r?\n/
                );
 
            for (
                const line
                of lines
            ) {
 
                const cleanLine =
                    line.trim();
 
                if (cleanLine) {
 
                    this.onLine(
                        cleanLine
                    );
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
 
        const data =
            new TextEncoder().encode(
                command
            );
 
        await this.commandCharacteristic
            .writeValue(data);
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
            return new WebUSBTransport(processSerialLine);
        }
 
        if ("serial" in navigator) {
            addSerialLine("V43: USB transport = Web Serial (PC)", "serial-info");
            return new WebSerialTransport(processSerialLine);
        }
 
        if ("usb" in navigator) {
            addSerialLine("V43: USB transport = WebUSB fallback (PC)", "serial-info");
            return new WebUSBTransport(processSerialLine);
        }
 
        throw new Error("USB: brak Web Serial oraz WebUSB.");
    }
 
    // BLE: PC + Android -> Web Bluetooth
    if (selectedTransport === "ble") {
        if ("bluetooth" in navigator) {
            addSerialLine("V43: BLE transport = Web Bluetooth", "serial-info");
            return new WebBluetoothTransport(processSerialLine);
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
// PARSE LIVE DATA
// ========================================================
 
function parseLiveData(line) {
 
    const parts =
        line.split(",");
 
    if (
        parts.length <
        10
    ) {
 
        return;
    }
 
    if (
        parts[0] !==
        "LIVE"
    ) {
 
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
 
 
    lastHeartbeatTime =
        Date.now();
 
 
    if (!measuring) {
 
        setStatus(
            "Live sensor",
            "connected"
        );
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
            "usb"
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
// PROCESS SENSOR LINE
// ========================================================
 
function processSerialLine(line) {
 
    if (!line) {
        return;
    }
 
 
    // ====================================================
    // SERIAL MONITOR
    // ====================================================
 
    if (!isSensorDataLine(line)) {
        addSerialLine(line);
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
            selectedTransport ===
                "usb"
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
            startButton.disabled = false;
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
    // LIVE DATA
    // ====================================================
 
    if (
        line.startsWith(
            "LIVE,"
        )
    ) {
 
        parseLiveData(line);
 
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
// CONNECT SENSOR
// ========================================================
 
async function connectSensor() {
 
    if (sensorTransport) {
        return;
    }
 
    sensorReady = false;
 
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
 
        await sensorTransport.connect();
 
 
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
 
        startHeartbeatMonitor();
 
 
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
        // USB
        // ------------------------------------------------
 
        if (
            selectedTransport ===
            "usb"
        ) {
 
            if (!sensorReady) {
 
                if (measurementStatus) {
 
                    measurementStatus.textContent =
                        "Waiting for sensor READY...";
 
                    measurementStatus.className =
                        "measurement-status active";
                }
 
                addSerialLine(
                    "Waiting for sensor READY...",
                    "serial-info"
                );
 
                await waitForSensorReady(
                    7000
                );
            }
 
            waitingForInitialReady =
                false;
 
            // V40:
            // USB CONNECT enters LIVE after sensor readiness.
            // V39 only waited for READY/HEARTBEAT and did not send L.
            await startLiveMode();
        
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
 
 
    // ----------------------------------------------------
    // BLE CURRENT LIMITATION
    // ----------------------------------------------------
 
    if (
        selectedTransport ===
        "ble"
    ) {
 
        setStatus(
            "BLE measurement not available yet",
            "error"
        );
 
        if (measurementStatus) {
 
            measurementStatus.textContent =
                "BLE currently supports LIVE only. Measurement protocol will be added later.";
 
            measurementStatus.className =
                "measurement-status";
        }
 
        addSerialLine(
            "BLE: command S is not implemented in BLE firmware v5.",
            "serial-info"
        );
 
        return;
    }
 
 
    // ----------------------------------------------------
    // USB MEASUREMENT
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
    // READY / HEARTBEAT will trigger L.
}
 
 
// ========================================================
// STOP MEASUREMENT
// ========================================================
 
async function stopMeasurement() {
 
    if (!sensorTransport) {
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
// SELECT BLE
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
// BUTTON EVENTS
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
