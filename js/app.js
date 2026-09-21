// ========================================================
// GAZELA SPINER SENSOR — SENSOR LAB
// app.js
// ========================================================


// ========================================================
// GLOBAL VARIABLES
// ========================================================

let port = null;
let reader = null;

let measuring = false;

let currentMovement = 0;
let currentMovementStart = null;

let sessionStartTime = null;
let sessionEndTime = null;

let sampleCount = 0;

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

const connectButton =
    document.getElementById("connectButton");

const disconnectButton =
    document.getElementById("disconnectButton");

const startButton =
    document.getElementById("startButton");

const stopButton =
    document.getElementById("stopButton");

const measurementStatus =
    document.getElementById("measurementStatus");

const sessionBadge =
    document.getElementById("sessionBadge");

const movementList =
    document.getElementById("movementList");

const serialMonitor =
    document.getElementById("serialMonitor");


// ========================================================
// INITIAL STATE
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

        statusDot.className =
            "status-dot";

        if (state) {
            statusDot.classList.add(state);
        }

    }

}


// ========================================================
// SERIAL MONITOR
// ========================================================

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

function formatTime(
    milliseconds
) {

    if (
        !Number.isFinite(
            milliseconds
        )
    ) {

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
// HEARTBEAT MONITOR
// ========================================================

function startHeartbeatMonitor() {

    stopHeartbeatMonitor();

    lastHeartbeatTime =
        Date.now();

    heartbeatMonitor =
        setInterval(() => {

            if (!port) {
                return;
            }

            const timeSinceHeartbeat =
                Date.now() -
                lastHeartbeatTime;

            if (
                timeSinceHeartbeat >
                HEARTBEAT_TIMEOUT
            ) {

                if (!measuring) {

                    setStatus(
                        "Sensor connection lost",
                        "error"
                    );

                }

            }

        }, 500);

}


// ========================================================
// STOP HEARTBEAT MONITOR
// ========================================================

function stopHeartbeatMonitor() {

    if (heartbeatMonitor) {

        clearInterval(
            heartbeatMonitor
        );

        heartbeatMonitor =
            null;

    }

}


// ========================================================
// RESET LIVE VALUES
// ========================================================

function resetLiveValues() {

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

function parseLiveData(
    line
) {

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
            formatNumber(Angle, 1);
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
            formatNumber(AngleY, 1);
    }


    lastHeartbeatTime =
        Date.now();

}


// ========================================================
// PROCESS SERIAL LINE
// ========================================================

function processSerialLine(
    line
) {

    if (!line) {
        return;
    }

    addSerialLine(line);


    // ----------------------------------------------------
    // HEARTBEAT
    // ----------------------------------------------------

    if (
        line ===
        "HEARTBEAT"
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
        line ===
        "READY"
    ) {

        measuring =
            false;

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
        line ===
        "INFO,LIVE_MODE"
    ) {

        measuring =
            false;

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
    // LIVE START
    // ----------------------------------------------------

    if (
        line ===
        "INFO,LIVE_START"
    ) {

        measuring =
            false;

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
        line ===
        "INFO,LIVE_STOP"
    ) {

        return;

    }


    // ----------------------------------------------------
    // MEASUREMENT START
    // ----------------------------------------------------

    if (
        line ===
        "INFO,START"
    ) {

        measuring =
            true;

        sessionStartTime =
            Date.now();

        sessionEndTime =
            null;

        sampleCount =
            0;

        currentMovement =
            0;

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
                parseFloat(
                    parts[2]
                );

            const AY =
                parseFloat(
                    parts[3]
                );

            const AZ =
                parseFloat(
                    parts[4]
                );

            const G =
                parseFloat(
                    parts[5]
                );

            const Angle =
                parseFloat(
                    parts[6]
                );

            const GX =
                parseFloat(
                    parts[7]
                );

            const GY =
                parseFloat(
                    parts[8]
                );

            const GZ =
                parseFloat(
                    parts[9]
                );

            const AngleY =
                parseFloat(
                    parts[10]
                );


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
                    formatNumber(Angle, 1);
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
                    formatNumber(AngleY, 1);
            }

        }

        return;
    }


    // ----------------------------------------------------
    // END OF SESSION
    // ----------------------------------------------------

    if (
        line ===
        "END,ALL_MOVEMENTS"
    ) {

        finishSession();

        return;
    }


    // ----------------------------------------------------
    // LIVE DATA
    // ----------------------------------------------------

    if (
        line.startsWith(
            "LIVE,"
        )
    ) {

        parseLiveData(
            line
        );

        return;
    }

}


// ========================================================
// READ SERIAL
// ========================================================

async function readSerial() {

    if (!port) {
        return;
    }

    try {

        const decoder =
            new TextDecoder();

        reader =
            port.readable.getReader();

        let buffer =
            "";

        while (true) {

            const {
                value,
                done
            } =
                await reader.read();

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

                if (
                    cleanLine
                ) {

                    processSerialLine(
                        cleanLine
                    );

                }

            }

        }

    }
    catch (error) {

        console.error(
            error
        );

        if (port) {

            setStatus(
                "Serial connection error",
                "error"
            );

        }

    }
    finally {

        if (reader) {

            try {
                reader.releaseLock();
            }
            catch (error) {
                console.warn(error);
            }

            reader =
                null;

        }

    }

}


// ========================================================
// SEND COMMAND
// ========================================================

async function sendCommand(
    command
) {

    if (
        !port ||
        !port.writable
    ) {

        return;

    }

    const writer =
        port.writable.getWriter();

    try {

        await writer.write(
            new TextEncoder().encode(
                command + "\n"
            )
        );

        addSerialLine(
            "> " + command,
            "serial-command"
        );

    }
    finally {

        writer.releaseLock();

    }

}


// ========================================================
// START LIVE MODE
// ========================================================

async function startLiveMode() {

    if (
        !port ||
        !port.writable
    ) {

        return;

    }

    try {

        await sendCommand(
            "L"
        );

        measuring =
            false;

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

        console.error(
            error
        );

        setStatus(
            "Live mode error",
            "error"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Unable to return to LIVE mode.";

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

    if (
        !("serial" in navigator)
    ) {

        alert(
            "Web Serial API is not supported. Use Google Chrome or Microsoft Edge."
        );

        return;

    }

    try {

        port =
            await navigator.serial.requestPort();

        await port.open({
            baudRate: 115200
        });


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
            "Serial port connected.",
            "serial-info"
        );


        resetLiveValues();


        startHeartbeatMonitor();


        readSerial();


        // ------------------------------------------------
        // ENTER LIVE MODE
        // ------------------------------------------------

        setTimeout(
            () => {

                startLiveMode();

            },
            300
        );

    }
    catch (error) {

        console.error(
            error
        );

        port =
            null;

        setStatus(
            "Connection failed",
            "error"
        );

        addSerialLine(
            "CONNECT ERROR: " +
            error.message,
            "serial-error"
        );

    }

}


// ========================================================
// START MEASUREMENT
// ========================================================

async function startMeasurement() {

    if (
        !port ||
        !port.writable
    ) {

        return;

    }

    try {

        measuring =
            true;

        sampleCount =
            0;

        currentMovement =
            0;

        sessionStartTime =
            Date.now();

        sessionEndTime =
            null;


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
            startButton.disabled = true;
        }

        if (stopButton) {
            stopButton.disabled = false;
        }


        await sendCommand(
            "S"
        );

    }
    catch (error) {

        console.error(
            error
        );

        measuring =
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

    measuring =
        false;

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


    // ====================================================
    // RETURN TO LIVE MODE
    // ====================================================

    setTimeout(
        () => {

            startLiveMode();

        },
        300
    );

}


// ========================================================
// STOP MEASUREMENT
// ========================================================

async function stopMeasurement() {

    if (!port) {
        return;
    }

    try {

        measuring =
            false;

        await sendCommand(
            "Q"
        );

        if (measurementStatus) {

            measurementStatus.textContent =
                "Stopping measurement...";

        }

    }
    catch (error) {

        console.error(
            error
        );

    }

}


// ========================================================
// DISCONNECT SENSOR
// ========================================================

async function disconnectSensor() {

    stopHeartbeatMonitor();


    try {

        if (port) {

            try {

                await sendCommand(
                    "Q"
                );

            }
            catch (error) {

                console.warn(
                    "Unable to send Q:",
                    error
                );

            }


            if (reader) {

                try {

                    await reader.cancel();

                }
                catch (error) {

                    console.warn(
                        error
                    );

                }

            }


            try {

                await port.close();

            }
            catch (error) {

                console.warn(
                    error
                );

            }

        }

    }
    finally {

        port =
            null;

        reader =
            null;

        measuring =
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
            "Sensor not connected",
            "neutral"
        );


        if (measurementStatus) {

            measurementStatus.textContent =
                "Sensor disconnected.";

            measurementStatus.className =
                "measurement-status";

        }


        addSerialLine(
            "Serial port disconnected.",
            "serial-info"
        );

    }

}


// ========================================================
// BUTTON EVENTS
// ========================================================

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
// INITIAL STATUS
// ========================================================

setStatus(
    "Sensor not connected",
    "neutral"
);

resetLiveValues();
