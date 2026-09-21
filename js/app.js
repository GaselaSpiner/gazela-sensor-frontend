// GAZELA SPINER SENSOR LAB
  //
  // Firmware:
  // Gazela Sensor v17.3
  //
  // SESSION
  //   ├── Movement 1
  //   ├── Movement 2
  //   ├── Movement 3
  //   ├── Movement 4
  //   └── Movement 5
  //
  // Dane są obecnie przechowywane tylko w pamięci przeglądarki.
  // ========================================================


  // ========================================================
  // SERIAL VARIABLES
  // ========================================================

  let port = null;

  let reader = null;

  let writer = null;

  let keepReading = false;

  let measuring = false;

  let buffer = "";


  // ========================================================
  // SESSION DATA
  // ========================================================

  let currentSession = null;

  let currentMovement = null;

  let sessionCounter = 0;

  let samplesReceived = 0;


  // ========================================================
  // ELEMENTS
  // ========================================================

  const connectButton =
    document.getElementById("connectButton");

  const disconnectButton =
    document.getElementById("disconnectButton");

  const startButton =
    document.getElementById("startButton");

  const stopButton =
    document.getElementById("stopButton");

  const serialMonitor =
    document.getElementById("serialMonitor");

  const statusDot =
    document.getElementById("statusDot");

  const statusText =
    document.getElementById("statusText");

  const measurementStatus =
    document.getElementById("measurementStatus");

  const movementList =
    document.getElementById("movementList");

  const sessionBadge =
    document.getElementById("sessionBadge");


  // ========================================================
  // SERIAL LOG
  // ========================================================

  function addSerialLine(
    text,
    type = ""
  ) {

    const line =
      document.createElement("div");

    line.className =
      "serial-line";


    if (type) {

      line.classList.add(type);

    }


    line.textContent =
      text;


    serialMonitor.appendChild(line);


    serialMonitor.scrollTop =
      serialMonitor.scrollHeight;

  }


  // ========================================================
  // STATUS
  // ========================================================

  function setStatus(
    text,
    type = ""
  ) {

    statusText.textContent =
      text;


    statusDot.className =
      "status-dot";


    if (type) {

      statusDot.classList.add(type);

    }

  }


  // ========================================================
  // START NEW SESSION
  // ========================================================

  function createSession() {

    sessionCounter++;


    currentSession = {

      id:
        "SESSION-" +
        Date.now(),

      number:
        sessionCounter,

      startedAt:
        new Date(),

      movements: []

    };


    currentMovement =
      null;


    samplesReceived =
      0;


    document.getElementById(
      "samplesValue"
    ).textContent =
      "0";


    sessionBadge.textContent =
      "Session " +
      currentSession.number;


    movementList.innerHTML = "";


    measurementStatus.textContent =
      "Session created. Waiting for movements.";

    measurementStatus.className =
      "measurement-status active";

  }


  // ========================================================
  // CREATE MOVEMENT
  // ========================================================

  function createMovement(
    movementNumber
  ) {

    if (!currentSession) {

      createSession();

    }


    // Jeżeli taki ruch już istnieje,
    // wykorzystujemy istniejący.

    let movement =
      currentSession.movements.find(
        item =>
          item.number === movementNumber
      );


    if (!movement) {

      movement = {

        number:
          movementNumber,

        samples: [],

        startedAt:
          new Date(),

        endedAt:
          null,

        status:
          "recording"

      };


      currentSession.movements.push(
        movement
      );

    }


    currentMovement =
      movement;


    renderMovements();

  }


  // ========================================================
  // FINISH MOVEMENT
  // ========================================================

  function finishCurrentMovement() {

    if (!currentMovement) {

      return;

    }


    if (
      currentMovement.status ===
      "recording"
    ) {

      currentMovement.endedAt =
        new Date();

      currentMovement.status =
        "completed";

    }


    renderMovements();

  }


  // ========================================================
  // FINISH SESSION
  // ========================================================

  function finishSession() {

    finishCurrentMovement();


    if (currentSession) {

      currentSession.endedAt =
        new Date();

    }


    currentMovement =
      null;


    measuring =
      false;


    renderMovements();


    measurementStatus.textContent =
      "Session finished. " +
      currentSession.movements.length +
      " movement(s) received.";

    measurementStatus.className =
      "measurement-status finished";


    setStatus(
      "Measurement finished",
      "connected"
    );


    startButton.disabled =
      false;

    stopButton.disabled =
      true;

  }


  // ========================================================
  // RENDER MOVEMENTS
  // ========================================================

  function renderMovements() {

    if (
      !currentSession ||
      currentSession.movements.length === 0
    ) {

      movementList.innerHTML =

        `<div class="movement-card">
          <div class="movement-status">
            Brak zarejestrowanych ruchów.
          </div>
        </div>`;

      return;

    }


    movementList.innerHTML = "";


    currentSession.movements.forEach(
      movement => {

        const card =
          document.createElement("div");


        card.className =
          "movement-card";


        if (
          currentMovement &&
          currentMovement.number ===
          movement.number
        ) {

          card.classList.add(
            "active"
          );

        }


        if (
          movement.status ===
          "completed"
        ) {

          card.classList.add(
            "completed"
          );

        }


        const sampleCount =
          movement.samples.length;


        let duration =
          "—";


        if (
          movement.samples.length > 1
        ) {

          const first =
            movement.samples[0];

          const last =
            movement.samples[
              movement.samples.length - 1
            ];


          duration =
            (
              last.timeMs -
              first.timeMs
            ) +
            " ms";

        }


        let lastSample =
          null;


        if (sampleCount > 0) {

          lastSample =
            movement.samples[
              sampleCount - 1
            ];

        }


        const lastG =
          lastSample
            ? lastSample.G.toFixed(3)
            : "—";


        const lastAngle =
          lastSample
            ? lastSample.Angle.toFixed(2)
            : "—";


        const lastGZ =
          lastSample
            ? lastSample.GZ.toFixed(2)
            : "—";


        card.innerHTML = `

          <div class="movement-top">

            <div class="movement-title">
              Movement ${movement.number}
            </div>

            <div class="movement-status">
              ${
                movement.status === "completed"
                  ? "Completed"
                  : "Recording"
              }
            </div>

          </div>


          <div class="movement-data">

            <div class="movement-data-item">

              <div class="movement-data-label">
                Samples
              </div>

              <div class="movement-data-value">
                ${sampleCount}
              </div>

            </div>


            <div class="movement-data-item">

              <div class="movement-data-label">
                Duration
              </div>

              <div class="movement-data-value">
                ${duration}
              </div>

            </div>


            <div class="movement-data-item">

              <div class="movement-data-label">
                Last G
              </div>

              <div class="movement-data-value">
                ${lastG} g
              </div>

            </div>


            <div class="movement-data-item">

              <div class="movement-data-label">
                Last Angle
              </div>

              <div class="movement-data-value">
                ${lastAngle}°
              </div>

            </div>


            <div class="movement-data-item">

              <div class="movement-data-label">
                Last GZ
              </div>

              <div class="movement-data-value">
                ${lastGZ} °/s
              </div>

            </div>

          </div>
        `;


        movementList.appendChild(
          card
        );

      }
    );

  }


  // ========================================================
  // UPDATE LIVE SENSOR
  // ========================================================

  function updateLiveSensor(
    data
  ) {

    document.getElementById(
      "movementValue"
    ).textContent =
      data.movement;


    document.getElementById(
      "timeValue"
    ).textContent =
      data.timeMs +
      " ms";


    setNumber(
      "ax",
      data.AX
    );

    setNumber(
      "ay",
      data.AY
    );

    setNumber(
      "az",
      data.AZ
    );

    setNumber(
      "g",
      data.G
    );

    setNumber(
      "angle",
      data.Angle
    );

    setNumber(
      "gx",
      data.GX
    );

    setNumber(
      "gy",
      data.GY
    );

    setNumber(
      "gz",
      data.GZ
    );

    setNumber(
      "angley",
      data.AngleY
    );

  }


  // ========================================================
  // PARSE SENSOR DATA
  // ========================================================

  function parseSensorData(
    line
  ) {

    const parts =
      line.split(",");


    if (
      parts.length < 11
    ) {

      return;

    }


    const movement =
      Number(parts[0]);


    const timeMs =
      Number(parts[1]);


    if (
      !Number.isFinite(movement) ||
      !Number.isFinite(timeMs)
    ) {

      return;

    }


    const data = {

      movement:
        movement,

      timeMs:
        timeMs,

      AX:
        Number(parts[2]),

      AY:
        Number(parts[3]),

      AZ:
        Number(parts[4]),

      G:
        Number(parts[5]),

      Angle:
        Number(parts[6]),

      GX:
        Number(parts[7]),

      GY:
        Number(parts[8]),

      GZ:
        Number(parts[9]),

      AngleY:
        Number(parts[10])

    };


    // ------------------------------------------
    // CHECK NUMBERS
    // ------------------------------------------

    if (
      !Number.isFinite(data.AX) ||
      !Number.isFinite(data.AY) ||
      !Number.isFinite(data.AZ) ||
      !Number.isFinite(data.G) ||
      !Number.isFinite(data.Angle) ||
      !Number.isFinite(data.GX) ||
      !Number.isFinite(data.GY) ||
      !Number.isFinite(data.GZ) ||
      !Number.isFinite(data.AngleY)
    ) {

      return;

    }


    // ------------------------------------------
    // SESSION
    // ------------------------------------------

    if (!currentSession) {

      createSession();

    }


    // ------------------------------------------
    // MOVEMENT
    // ------------------------------------------

    if (
      !currentMovement ||
      currentMovement.number !==
      movement
    ) {

      if (
        currentMovement
      ) {

        finishCurrentMovement();

      }


      createMovement(
        movement
      );

    }


    // ------------------------------------------
    // SAVE SAMPLE IN MEMORY
    // ------------------------------------------

    currentMovement.samples.push(
      data
    );


    samplesReceived++;


    // ------------------------------------------
    // LIVE DISPLAY
    // ------------------------------------------

    document.getElementById(
      "samplesValue"
    ).textContent =
      samplesReceived;


    updateLiveSensor(
      data
    );


    // ------------------------------------------
    // UPDATE MOVEMENT UI
    // ------------------------------------------

    renderMovements();

  }


  // ========================================================
  // NUMBER DISPLAY
  // ========================================================

  function setNumber(
    id,
    value
  ) {

    const element =
      document.getElementById(
        id
      );


    if (
      !Number.isFinite(value)
    ) {

      element.textContent =
        "—";

      return;

    }


    element.textContent =
      value.toFixed(3);

  }


  // ========================================================
  // PROCESS SERIAL LINE
  // ========================================================

  function processSerialLine(
    line
  ) {

    addSerialLine(
      line,
      "serial-data"
    );


    // ------------------------------------------
    // READY
    // ------------------------------------------

    if (
      line === "READY"
    ) {

      if (!measuring) {

        setStatus(
          "Sensor ready",
          "connected"
        );

      }

      return;

    }


    // ------------------------------------------
    // START
    // ------------------------------------------

    if (
      line === "INFO,START"
    ) {

      measuring =
        true;


      if (!currentSession) {

        createSession();

      }


      setStatus(
        "Measurement running",
        "measuring"
      );


      measurementStatus.textContent =
        "Measurement running...";


      measurementStatus.className =
        "measurement-status active";


      return;

    }


    // ------------------------------------------
    // PREPARE
    // ------------------------------------------

    if (
      line === "INFO,PREPARE"
    ) {

      measuring =
        true;


      setStatus(
        "Preparing sensor...",
        "measuring"
      );


      measurementStatus.textContent =
        "Preparing measurement...";


      measurementStatus.className =
        "measurement-status active";


      return;

    }


    // ------------------------------------------
    // MOVEMENT
    // ------------------------------------------

    if (
      line.startsWith(
        "INFO,MOVEMENT_"
      )
    ) {

      const match =
        line.match(
          /INFO,MOVEMENT_(\d+)/
        );


      if (match) {

        const movementNumber =
          Number(match[1]);


        if (
          currentMovement &&
          currentMovement.number !==
          movementNumber
        ) {

          finishCurrentMovement();

        }


        createMovement(
          movementNumber
        );


        setStatus(
          "Movement " +
          movementNumber,
          "measuring"
        );

      }


      return;

    }


    // ------------------------------------------
    // WAIT
    // ------------------------------------------

    if (
      line.startsWith(
        "INFO,WAIT_AFTER_MOVEMENT_"
      )
    ) {

      return;

    }


    // ------------------------------------------
    // END
    // ------------------------------------------

    if (
      line === "END,ALL_MOVEMENTS"
    ) {

      finishSession();

      return;

    }


    // ------------------------------------------
    // HEADER
    // ------------------------------------------

    if (
      line.startsWith(
        "MOVEMENT,TIME_ms"
      )
    ) {

      addSerialLine(
        "CSV HEADER DETECTED",
        "serial-info"
      );


      return;

    }


    // ------------------------------------------
    // ERROR
    // ------------------------------------------

    if (
      line === "ERROR,IMU"
    ) {

      setStatus(
        "IMU error",
        "error"
      );


      addSerialLine(
        "IMU ERROR",
        "serial-error"
      );


      return;

    }


    // ------------------------------------------
    // DATA
    // ------------------------------------------

    parseSensorData(
      line
    );

  }


  // ========================================================
  // SERIAL READ
  // ========================================================

  async function readSerial() {

    if (!port) {

      return;

    }


    const decoder =
      new TextDecoder();


    try {

      while (
        port.readable &&
        keepReading
      ) {

        reader =
          port.readable.getReader();


        try {

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


            const text =
              decoder.decode(
                value,
                {
                  stream: true
                }
              );


            buffer +=
              text;


            const lines =
              buffer.split(
                /\r?\n/
              );


            buffer =
              lines.pop();


            for (
              const line
              of lines
            ) {

              const clean =
                line.trim();


              if (
                clean
              ) {

                processSerialLine(
                  clean
                );

              }

            }

          }

        }
        finally {

          reader.releaseLock();

          reader = null;

        }

      }

    }
    catch (error) {

      console.error(
        error
      );


      addSerialLine(
        "SERIAL ERROR: " +
        error.message,
        "serial-error"
      );


      setStatus(
        "Serial error",
        "error"
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
        "Web Serial API nie jest dostępne. Użyj Google Chrome lub Microsoft Edge."
      );


      return;

    }


    try {

      port =
        await navigator.serial.requestPort();


      await port.open({
        baudRate: 115200
      });


      setStatus(
        "Sensor connected",
        "connected"
      );


      addSerialLine(
        "CONNECTED TO GAZELA SENSOR",
        "serial-info"
      );


      addSerialLine(
        "BAUD RATE: 115200",
        "serial-info"
      );


      connectButton.disabled =
        true;


      disconnectButton.disabled =
        false;


      startButton.disabled =
        false;


      measurementStatus.textContent =
        "Sensor connected. Ready for measurement.";


      measurementStatus.className =
        "measurement-status";


      keepReading =
        true;


      readSerial();

    }
    catch (error) {

      console.error(
        error
      );


      addSerialLine(
        "CONNECTION ERROR: " +
        error.message,
        "serial-error"
      );


      setStatus(
        "Connection error",
        "error"
      );

    }

  }


  // ========================================================
  // START MEASUREMENT
  // ========================================================

  async function startMeasurement() {

    if (!port) {

      alert(
        "Najpierw połącz sensor."
      );


      return;

    }


    if (!port.writable) {

      addSerialLine(
        "ERROR: Port is not writable.",
        "serial-error"
      );


      return;

    }


    // ------------------------------------------
    // NEW SESSION
    // ------------------------------------------

    createSession();


    measuring =
      true;


    setStatus(
      "Starting measurement...",
      "measuring"
    );


    measurementStatus.textContent =
      "Starting measurement...";


    measurementStatus.className =
      "measurement-status active";


    startButton.disabled =
      true;


    stopButton.disabled =
      false;


    // ------------------------------------------
    // SEND S
    // ------------------------------------------

    try {

      writer =
        port.writable.getWriter();


      const encoder =
        new TextEncoder();


      await writer.write(
        encoder.encode(
          "S\n"
        )
      );


      writer.releaseLock();

      writer = null;


      addSerialLine(
        "> S",
        "serial-info"
      );

    }
    catch (error) {

      console.error(
        error
      );


      if (writer) {

        try {

          writer.releaseLock();

        }
        catch (e) {}

        writer = null;

      }


      measuring =
        false;


      startButton.disabled =
        false;


      stopButton.disabled =
        true;


      setStatus(
        "Measurement error",
        "error"
      );


      addSerialLine(
        "START ERROR: " +
        error.message,
        "serial-error"
      );

    }

  }


  // ========================================================
  // STOP
  // ========================================================

  function stopMeasurement() {

    /*
      v17.3 nie ma obecnie osobnej komendy STOP.
      Ten przycisk zatrzymuje tylko stan aplikacji.
    */


    measuring =
      false;


    stopButton.disabled =
      true;


    startButton.disabled =
      false;


    setStatus(
      "Sensor connected",
      "connected"
    );


    measurementStatus.textContent =
      "Measurement state stopped in browser.";


    measurementStatus.className =
      "measurement-status";


    addSerialLine(
      "> STOP (browser only)",
      "serial-info"
    );

  }


  // ========================================================
  // DISCONNECT
  // ========================================================

  async function disconnectSensor() {

    keepReading =
      false;


    measuring =
      false;


    try {

      if (reader) {

        await reader.cancel();

        reader = null;

      }

    }
    catch (error) {

      console.warn(
        error
      );

    }


    try {

      if (port) {

        await port.close();

      }

    }
    catch (error) {

      console.warn(
        error
      );

    }


    port =
      null;


    connectButton.disabled =
      false;


    disconnectButton.disabled =
      true;


    startButton.disabled =
      true;


    stopButton.disabled =
      true;


    setStatus(
      "Sensor not connected"
    );


    measurementStatus.textContent =
      "Sensor disconnected.";


    measurementStatus.className =
      "measurement-status";


    addSerialLine(
      "DISCONNECTED",
      "serial-info"
    );

  }


  // ========================================================
  // BUTTON EVENTS
  // ========================================================

  connectButton.addEventListener(
    "click",
    connectSensor
  );


  disconnectButton.addEventListener(
    "click",
    disconnectSensor
  );


  startButton.addEventListener(
    "click",
    startMeasurement
  );


  stopButton.addEventListener(
    "click",
    stopMeasurement
  );


  // ========================================================
  // INITIAL STATE
  // ========================================================

  if (
    !("serial" in navigator)
  ) {

    setStatus(
      "Web Serial unavailable",
      "error"
    );


    connectButton.disabled =
      true;


    addSerialLine(
      "Web Serial API is not supported in this browser.",
      "serial-error"
    );

  }


  // ========================================================
  // DEVICE DISCONNECT
  // ========================================================

  if (
    "serial" in navigator
  ) {

    navigator.serial.addEventListener(
      "disconnect",
      event => {

        if (
          port &&
          event.target === port
        ) {

          disconnectSensor();

        }

      }
    );

  }


  // ========================================================
  // INITIAL MESSAGE
  // ========================================================

  addSerialLine(
    "Gazela Spiner Sensor Lab ready.",
    "serial-info"
  );


  addSerialLine(
    "Waiting for sensor connection...",
    "serial-info"
  );
