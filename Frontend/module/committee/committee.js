
"use strict";

const API_BASE =
  "https://voting-backend-cdrj.onrender.com/api";

const $ = id => document.getElementById(id);

let electionId = null;
let election = null;
let counting = null;
let ballots = [];
let busy = false;
let loaded = false;

function getToken() {
  return (
    sessionStorage.getItem("voting_token") ||
    localStorage.getItem("voting_token") ||
    localStorage.getItem("token")
  );
}

function notify(message, error = false) {
  if (typeof window.showToast === "function") {
    window.showToast(
      message,
      error ? "error" : "success"
    );
  } else {
    alert(message);
  }
}

async function confirmAction(message, title, text) {
  if (typeof window.showConfirmToast === "function") {
    return Boolean(
      await window.showConfirmToast(message, {
        title,
        confirmText: text,
        cancelText: "Cancel"
      })
    );
  }
  return window.confirm(message);
}

async function api(path, method = "GET", payload) {
  const token = getToken();
  if (!token) {
    throw new Error("Please log in as Committee.");
  }

  const headers = {
    Authorization: "Bearer " + token
  };

  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(API_BASE + path, {
    method,
    headers,
    cache: "no-store",
    ...(payload === undefined
      ? {}
      : { body: JSON.stringify(payload) })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.message ||
      result.error ||
      `Request failed (${response.status})`
    );
  }

  return result;
}

function validNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0
    ? number
    : null;
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value ?? "—";
}

function getTotals() {
  const data = counting?.ballots;
  if (!data) return null;

  const ISSUED = validNumber(data.ISSUED);
  const CAST = validNumber(data.CAST);
  const COUNTED = validNumber(data.COUNTED);
  const VOID = validNumber(data.VOID);

  if ([ISSUED, CAST, COUNTED, VOID].some(
    value => value === null
  )) return null;

  return { ISSUED, CAST, COUNTED, VOID };
}

// Official Super Admin closure is REQUIRED.
function canReconcile() {
  return (
    loaded &&
    electionId > 0 &&
    election &&
    election.voting_closed_at != null &&
    counting?.voting_open === false &&
    counting?.scanning_open === true &&
    getTotals() !== null
  );
}

function getSelected() {
  return Array.from(
    document.querySelectorAll(
      ".void-ballot-check:checked"
    ),
    box => box.value
  );
}

function renderStatus() {
  const t = getTotals();

  const registered = t
    ? t.ISSUED + t.CAST + t.COUNTED + t.VOID
    : null;

  const remaining = t
    ? t.ISSUED + t.CAST
    : null;

  setText("monitorRegistered", registered);
  setText("monitorCounted", t?.COUNTED);
  setText("monitorRemaining", remaining);
  setText("monitorVoid", t?.VOID);

  setText("monitorIssued", t?.ISSUED);
  setText("monitorCast", t?.CAST);
  setText("monitorStatusCounted", t?.COUNTED);
  setText("monitorStatusVoid", t?.VOID);

  setText("voidIssued", t?.ISSUED);
  setText("voidCast", t?.CAST);
  setText("voidCounted", t?.COUNTED);
  setText("voidVoided", t?.VOID);

  const percent = registered > 0
    ? Math.min(100, t.COUNTED / registered * 100)
    : 0;

  setText(
    "monitorProgressLabel",
    t ? `${t.COUNTED} / ${registered}` : "— / —"
  );

  setText(
    "monitorProgressPercent",
    t ? `${percent.toFixed(1)}% counted` : "—"
  );

  $("monitorProgressFill").style.width =
    `${percent}%`;

  $("monitorProgressBar").setAttribute(
    "aria-valuenow",
    String(percent)
  );

  setText(
    "monitorNote",
    "Registered QR Ballots = generated unique QR IDs. " +
    "Remaining to Resolve = ISSUED + CAST. " +
    "Physical printing is separate from vote counting."
  );

  const allowed = canReconcile();

  $("reconciliationLocked").hidden = allowed;
  $("reconciliationForm").hidden = !allowed;

  let statusMessage;

  if (!election || !counting) {
    statusMessage = "Election status unavailable.";
    setText(
      "reconciliationLockReason",
      "Cannot verify election status. Refresh the page."
    );
  } else if (election.voting_closed_at == null) {
    statusMessage =
      "Voting is not officially closed by Super Admin.";
    setText(
      "reconciliationLockReason",
      "Wait until Super Admin officially closes voting."
    );
  } else if (!counting.scanning_open) {
    statusMessage =
      "Scanning is closed. Reconciliation unavailable.";
    setText(
      "reconciliationLockReason",
      "Scanning is already closed."
    );
  } else if (!loaded) {
    statusMessage =
      "Ballot list could not be verified.";
    setText(
      "reconciliationLockReason",
      "Unable to load unused ballots. Refresh first."
    );
  } else {
    statusMessage =
      "Voting officially closed. " +
      "Scanning open. Verify unused ballots before VOID.";
  }

  setText("voidElectionState", statusMessage);
  updateButtons();
}

function updateButtons() {
  const selected = getSelected();
  const reason = $("voidReason").value.trim();
  const verified = $("voidVerified").checked;
  const t = getTotals();
  const allowed = canReconcile();

  setText(
    "voidSelectedCount",
    `${selected.length} selected`
  );

  $("voidSubmit").disabled = !(
    !busy &&
    allowed &&
    selected.length >= 1 &&
    selected.length <= 100 &&
    reason.length >= 10 &&
    reason.length <= 500 &&
    verified
  );

  $("finishScanCommittee").disabled = !(
    !busy &&
    allowed &&
    t &&
    t.ISSUED === 0 &&
    t.CAST === 0
  );

  $("voidSelectAll").disabled =
    busy || !allowed || ballots.length === 0;

  $("voidRefresh").disabled = busy;

  document.querySelectorAll(
    ".void-ballot-check"
  ).forEach(input => {
    input.disabled = busy || !allowed;
  });
}

function renderBallots() {
  const list = $("voidBallotList");
  list.replaceChildren();

  if (!ballots.length) {
    list.textContent = "No ISSUED ballots found.";
    updateButtons();
    return;
  }

  for (const ballot of ballots) {
    const label = document.createElement("label");
    label.className = "void-ballot-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "void-ballot-check";
    checkbox.value = String(ballot.ballot_id);

    const description = document.createElement("span");

    // Friendly number, if supplied by backend.
    // Real UUID is always retained internally.
    const number = ballot.ballot_number ??
      ballot.serial_number;

    description.textContent = number != null
      ? `Ballot #${number} · Batch ${ballot.batch_id}`
      : `Batch ${ballot.batch_id} · ${ballot.ballot_id}`;

    checkbox.addEventListener("change", () => {
      if (getSelected().length > 100) {
        checkbox.checked = false;
        notify("Maximum 100 ballots per request.", true);
      }
      updateButtons();
    });

    label.append(checkbox, description);
    list.appendChild(label);
  }

  updateButtons();
}

async function refresh(showError = true) {
  if (busy) return;

  loaded = false;
  election = null;
  counting = null;
  ballots = [];
  electionId = null;

  $("voidVerified").checked = false;
  $("voidSelectAll").checked = false;

  renderStatus();
  renderBallots();

  try {
    const current = await api(
      "/election/current/status"
    );

    const data = current.election;
    const id = Number(data?.election_id);

    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error("No current election available.");
    }

    election = data;
    electionId = id;

    const status = await api(
      `/election/${id}/counting-status`
    );

    if (Number(status.election_id) !== id) {
      throw new Error("Election status mismatch.");
    }

    counting = status;

    // Only load ballot IDs once official
    // closure has been confirmed.
    if (
      election.voting_closed_at != null &&
      counting.voting_open === false &&
      counting.scanning_open === true
    ) {
      const unused = await api(
        `/election/${id}/unused-ballots`
      );

      if (
        Number(unused.election_id) !== id ||
        !Array.isArray(unused.ballots)
      ) {
        throw new Error("Invalid unused-ballot response.");
      }

      ballots = unused.ballots;
    }

    loaded = true;
    renderStatus();
    renderBallots();

  } catch (error) {
    console.error("Monitor refresh failed:", error);
    loaded = false;
    ballots = [];

    renderStatus();
    renderBallots();

    if (showError) notify(error.message, true);
  }
}

async function voidSelected() {
  if (busy || !canReconcile()) return;

  const ids = getSelected();
  const reason = $("voidReason").value.trim();

  if (
    ids.length < 1 ||
    ids.length > 100 ||
    reason.length < 10 ||
    reason.length > 500 ||
    !$("voidVerified").checked
  ) {
    notify(
      "Select ballots, enter a reason of " +
      "10–500 characters, and verify them.",
      true
    );
    return;
  }

  const confirmed = await confirmAction(
    `Election ${electionId}\n` +
    `${ids.length} unused ballot(s)\n` +
    `Reason: ${reason}\n\n` +
    "Confirm these exact ballots were physically " +
    "verified as unused. VOID cannot normally " +
    "be reversed.",
    "Confirm Ballot VOID",
    "Void Selected Ballots"
  );

  if (!confirmed) return;

  busy = true;
  updateButtons();

  try {
    // Recheck election and ballot statuses.
    const latest = await api(
      `/election/${electionId}/counting-status`
    );

    const idsNow = await api(
      `/election/${electionId}/unused-ballots`
    );

    const available = new Set(
      (idsNow.ballots || []).map(
        b => String(b.ballot_id).toLowerCase()
      )
    );

    if (
      latest.voting_open !== false ||
      latest.scanning_open !== true ||
      ids.some(id => !available.has(id.toLowerCase()))
    ) {
      throw new Error(
        "Ballot status changed. Refresh and verify again."
      );
    }

    const result = await api(
      `/election/${electionId}/void-unused-ballots`,
      "POST",
      {
        ballot_ids: ids,
        reason,
        physically_verified: true
      }
    );

    notify(
      result.message ||
      "Verified unused ballots voided."
    );

    $("voidReason").value = "";
    $("voidVerified").checked = false;

  } catch (error) {
    console.error("VOID failed:", error);
    notify(error.message, true);
  } finally {
    busy = false;
    await refresh();
  }
}

async function finishScanning() {
  if (
    busy ||
    !canReconcile() ||
    $("finishScanCommittee").disabled
  ) return;

  const t = getTotals();

  if (!t || t.ISSUED !== 0 || t.CAST !== 0) {
    notify(
      "Resolve all ISSUED and CAST ballots first.",
      true
    );
    return;
  }

  const confirmed = await confirmAction(
    `Election ${electionId}\n` +
    `Counted: ${t.COUNTED}\n` +
    `VOID: ${t.VOID}\n\n` +
    "Close scanning permanently? " +
    "Confirm all physical ballots are reconciled.",
    "Finish Scanning",
    "Finish Scanning"
  );

  if (!confirmed) return;

  busy = true;
  updateButtons();

  try {
    const result = await api(
      `/election/${electionId}/finish-scanning`,
      "POST"
    );

    notify(
      result.message || "Scanning finished."
    );
  } catch (error) {
    console.error("Finish scanning failed:", error);
    notify(error.message, true);
  } finally {
    busy = false;
    await refresh();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("openVoidPanel").addEventListener(
    "click",
    async () => {
      const panel = $("voidDetails");
      panel.hidden = !panel.hidden;

      if (!panel.hidden) {
        await refresh();
      }
    }
  );

  $("voidRefresh").addEventListener(
    "click",
    () => refresh()
  );

  $("voidSelectAll").addEventListener(
    "change",
    event => {
      const boxes = [
        ...document.querySelectorAll(
          ".void-ballot-check"
        )
      ];

      boxes.forEach((box, index) => {
        box.checked =
          event.target.checked &&
          canReconcile() &&
          index < 100;
      });

      updateButtons();
    }
  );

  $("voidReason").addEventListener(
    "input",
    updateButtons
  );

  $("voidVerified").addEventListener(
    "change",
    updateButtons
  );

  $("voidSubmit").addEventListener(
    "click",
    voidSelected
  );

  $("finishScanCommittee").addEventListener(
    "click",
    finishScanning
  );

  refresh(false);
});
