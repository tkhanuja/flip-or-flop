import { APP_URL } from "./secrets.js";

const videoContainer = document.getElementById("video-container");
const recordVideo = document.getElementById("record-video");
const flopVideo = document.getElementById("flop-video");

let baseData = { current_streak: 0, max_record: 0 };
let localStreak = 0;
let localRecord = 0;
let isLoaded = false;

let apiQueue = [];
let isSending = false;

async function fetchInitialStats() {
  console.log("[INIT] Fetching initial stats from server...");
  try {
    const response = await fetch(APP_URL);
    const json = await response.json();

    baseData.current_streak = Number(json.current_streak) || 0;
    baseData.max_record = Number(json.max_record) || 0;

    localStreak = baseData.current_streak;
    localRecord = baseData.max_record;
    isLoaded = true;

    console.log("[INIT] Stats loaded successfully:", {
      baseData,
      localStreak,
      localRecord,
    });
    updateUI();
  } catch (error) {
    console.error("[INIT ERROR] Error fetching initial stats:", error);
    isLoaded = true;
    updateUI();
  }
}

function triggerVideoEffect(type) {
  // Show the widget container
  videoContainer.classList.remove("hidden");

  let activeVideo = type === "record" ? recordVideo : flopVideo;
  let inactiveVideo = type === "record" ? flopVideo : recordVideo;

  // Pause and reset the inactive video
  inactiveVideo.pause();
  inactiveVideo.currentTime = 0;
  inactiveVideo.style.display = "none";

  // Setup and play the active video
  activeVideo.style.display = "block";
  activeVideo.currentTime = 0;
  activeVideo.load();

  setTimeout(() => {
    activeVideo.play().catch((error) => {
      console.log("[VIDEO ERROR] Autoplay restricted:", error);
    });
  }, 50);

  // Automatically hide the entire widget container when the video ends
  activeVideo.onended = () => {
    videoContainer.classList.add("hidden");
    activeVideo.style.display = "none";
  };
}

function updateUI() {
  console.log(
    `[UI UPDATE] Rendering -> localStreak: ${localStreak}, localRecord: ${localRecord}`,
  );
  const streakEl = document.getElementById("current-streak");
  const recordEl = document.getElementById("max-record");

  if (streakEl) streakEl.innerText = localStreak;
    if (recordEl) recordEl.innerText = localRecord;
    const saveStatusEl = document.getElementById("save-status");
    if (saveStatusEl) {
        if (apiQueue.length > 0 || isSending) {
            saveStatusEl.innerText = "saving info... don't reload";
        } else {
            saveStatusEl.innerText = "";
        }
    }
    
}

window.registerResult = function (outcome) {
  if (!isLoaded) {
    console.warn("[ACTION WARNING] Still loading initial data from sheet...");
    return;
  }

  console.log(`[ACTION] User triggered: ${outcome}`);

  if (outcome === "FLIP") {
    localStreak += 1;
    console.log(`[STATE] FLIP processed. New localStreak: ${localStreak}`);

    if (localStreak > localRecord) {
      localRecord = localStreak;
      console.log(
        `[RECORD] New local record broken! localRecord: ${localRecord}`,
      );
      triggerVideoEffect("record");
    }

    triggerChickFlip();

    const lastItem = apiQueue[apiQueue.length - 1];
    if (lastItem && lastItem.action === "FLIP_BATCH") {
      lastItem.count += 1;
      console.log(
        `[QUEUE] Incremented existing FLIP_BATCH count to: ${lastItem.count}`,
      );
    } else {
      apiQueue.push({ action: "FLIP_BATCH", count: 1 });
      console.log(
        `[QUEUE] Pushed new FLIP_BATCH to queue. Queue length: ${apiQueue.length}`,
      );
    }
  } else {
    localStreak = 0;
    console.log(
      `[STATE] FLOP processed. localStreak reset to 0. localRecord maintained at: ${localRecord}`,
    );
    triggerVideoEffect("flop");

    apiQueue.push({ action: "FLOP" });
    console.log(
      `[QUEUE] Pushed FLOP to queue. Queue length: ${apiQueue.length}`,
    );
  }

  updateUI();
  processQueue();
};

function triggerChickFlip() {
  let container = document.getElementById("chick-container");
  if (!container) return;

  container.innerHTML = "";

  const chickEl = document.createElement("div");
  chickEl.innerHTML = `
        <svg width="48" height="48" viewBox="0 0 16 16" style="image-rendering: pixelated; width: 48px; height: 48px;">
            <path d="M5 5h6v6H5z" fill="#FFE869"/>
            <path d="M4 6h8v4H4z" fill="#FFE869"/>
            <path d="M9 6h1v1H9z" fill="#000"/>
            <path d="M11 7h2v1h-2z" fill="#FFA500"/>
            <path d="M6 11h1v2H6z M9 11h1v2H9z" fill="#FFA500"/>
        </svg>
    `;

  chickEl.style.animation = "pixelFlip 0.6s ease-in-out";
  container.appendChild(chickEl);

  setTimeout(() => {
    chickEl.remove();
  }, 600);
}

async function processQueue() {
  if (isSending || apiQueue.length === 0) {
    console.log(
      `[QUEUE STATUS] Skipping processQueue -> isSending: ${isSending}, queueLength: ${apiQueue.length}`,
    );
    return;
  }

  isSending = true;
  const payload = apiQueue.shift();
  console.log(
    `[API START] Sending payload to server:`,
    payload,
    `| Remaining queue length: ${apiQueue.length}`,
  );

  try {
    const response = await fetch(APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    console.log(`[API SUCCESS] Response received from server:`, json);

    if (json && typeof json.current_streak !== "undefined") {
      baseData.current_streak = Number(json.current_streak) || 0;

      const serverRecord = Number(json.max_record) || 0;
      baseData.max_record = Math.max(baseData.max_record, serverRecord);

      localRecord = Math.max(localRecord, baseData.max_record);

      if (apiQueue.length === 0) {
        localStreak = Math.max(localStreak, baseData.current_streak);
        console.log(
          `[SYNC COMPLETE] Queue empty. Final synced state -> baseData:`,
          baseData,
          `| localStreak: ${localStreak}, localRecord: ${localRecord}`,
        );
      } else {
        console.log(
          `[SYNC INTERMEDIATE] Queue still has ${apiQueue.length} items. Keeping local tracking values.`,
        );
      }

      updateUI();
    }
  } catch (error) {
    console.error("[API ERROR] Error posting to cloud:", error);
  } finally {
    isSending = false;
    console.log(`[API FINALLY] Request completed. isSending set to false.`);

    if (apiQueue.length > 0) {
      console.log(`[QUEUE] Processing next item in queue...`);
      processQueue();
    } else {
      console.log(`[QUEUE] Queue fully processed and empty.`);
    }
  }
}

fetchInitialStats();
