// Kunin ang active election_id mula sa URL query string (e.g. ?election_id=1) o default sa 1
const urlParams = new URLSearchParams(window.location.search);
const activeElectionId = urlParams.get('election_id') || 1;

const STORAGE_KEYS = {
  status: 'election_status',
  masked: 'names_masked'
};

/* --- API HELPER FUNCTION FOR AUTHENTICATED REQUESTS --- */
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(url, { ...options, headers });
  return response;
}

/* --- FETCH ELECTION STATUS FROM BACKEND --- */
async function fetchElectionStatus() {
  try {
    const res = await fetch(`/api/elections/${activeElectionId}/status`);
    if (!res.ok) throw new Error('Failed to fetch election status');

    const data = await res.json();
    const election = data.election;

    if (election) {
      // Map backend status to UI state
      let currentStatus = 'OPEN';
      if (election.status === 'completed' || election.is_active === 0) {
        currentStatus = 'CLOSED';
      } else if (election.status === 'active' || election.is_active === 1) {
        currentStatus = 'OPEN';
      }

      localStorage.setItem(STORAGE_KEYS.status, currentStatus);
      localStorage.setItem(STORAGE_KEYS.masked, election.mask_names ? 'true' : 'false');

      // Populate schedule inputs if available
      if (election.start_time) {
        const startTimeVal = new Date(election.start_time).toTimeString().slice(0, 5);
        const startTimeInput = document.getElementById('startTime');
        if (startTimeInput) startTimeInput.value = startTimeVal;
      }
      if (election.end_time) {
        const endTimeVal = new Date(election.end_time).toTimeString().slice(0, 5);
        const closingTimeInput = document.getElementById('closingTime');
        if (closingTimeInput) closingTimeInput.value = endTimeVal;
      }

      refreshStatusUI();
    }
  } catch (err) {
    console.warn('Backend status fetch error:', err);
    refreshStatusUI();
  }
}

/* --- FETCH PUBLIC CANDIDATES & LIVE RESULTS --- */
async function fetchPublicCandidatesAndResults() {
  try {
    const res = await fetch(`/api/elections/${activeElectionId}/candidates`);
    if (!res.ok) throw new Error('Failed to fetch public candidates');

    const data = await res.json();
    const candidates = data.candidates || [];
    const isMasked = data.mask_names;

    localStorage.setItem(STORAGE_KEYS.masked, isMasked ? 'true' : 'false');
    refreshStatusUI();

    renderLiveSidebarWithCandidates(candidates);
  } catch (err) {
    console.warn('Backend candidate fetch error:', err);
  }
}

/* --- ELECTION CONTROL ACTIONS --- */

// 1. Trigger Start Election Button
async function handleStartElectionClick() {
  try {
    const res = await apiFetch(`/api/elections/${activeElectionId}/start`, {
      method: 'POST'
    });
    const data = await res.json();

    if (res.ok) {
      setElectionStatus('OPEN');
      alert("The election has been officially STARTED! Live voting is now active.");
    } else {
      alert(data.message || 'Failed to start election.');
    }
  } catch (err) {
    console.error('Start election error:', err);
    alert('Network error attempting to start election.');
  }
}

// 2. Submit Schedule Form
async function handleStartElection(event) {
  event.preventDefault();
  const startTimeVal = document.getElementById('startTime').value;
  const closingTimeVal = document.getElementById('closingTime').value;

  const today = new Date().toISOString().split('T')[0];
  const start_time = `${today} ${startTimeVal}:00`;
  const end_time = `${today} ${closingTimeVal}:00`;

  try {
    const res = await apiFetch(`/api/elections/${activeElectionId}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify({ start_time, end_time })
    });
    const data = await res.json();

    if (res.ok) {
      alert(`Election Schedule Saved successfully:\nStart: ${startTimeVal}\nClose: ${closingTimeVal}`);
    } else {
      alert(data.message || 'Failed to update election schedule.');
    }
  } catch (err) {
    console.error('Schedule update error:', err);
    alert('Network error updating schedule.');
  }
}

// 3. Trigger Stop Voting Button
async function handleStopVoting() {
  if (getElectionStatus() === 'CLOSED') return;
  const confirmed = confirm(
    'Are you sure you want to PERMANENTLY STOP the voting process? This action cannot be undone and candidate names will be revealed.'
  );
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/api/elections/${activeElectionId}/stop`, {
      method: 'POST'
    });
    const data = await res.json();

    if (res.ok) {
      setElectionStatus('CLOSED');
      alert("The election has been CLOSED. Votes are now being consolidated.");
    } else {
      alert(data.message || 'Failed to stop voting.');
    }
  } catch (err) {
    console.error('Stop voting error:', err);
    alert('Network error attempting to stop voting.');
  }
}

// 4. Trigger Toggle Mask Names Button
async function handleMaskToggle() {
  try {
    const res = await apiFetch(`/api/elections/${activeElectionId}/mask`, {
      method: 'POST'
    });
    const data = await res.json();

    if (res.ok) {
      setNamesMasked(data.mask_names);
      fetchPublicCandidatesAndResults();
    } else {
      alert(data.message || 'Failed to toggle mask names.');
    }
  } catch (err) {
    console.error('Toggle mask error:', err);
    alert('Network error toggling candidate masking.');
  }
}

/* --- UI HELPERS --- */
function getElectionStatus() {
  return localStorage.getItem(STORAGE_KEYS.status) || 'OPEN';
}

function getNamesMasked() {
  return localStorage.getItem(STORAGE_KEYS.masked) === 'true';
}

function setElectionStatus(status) {
  localStorage.setItem(STORAGE_KEYS.status, status);
  refreshStatusUI();
}

function setNamesMasked(masked) {
  localStorage.setItem(STORAGE_KEYS.masked, masked ? 'true' : 'false');
  refreshStatusUI();
}

function refreshStatusUI() {
  const status = getElectionStatus();
  const masked = getNamesMasked();

  const statusTextEl = document.getElementById('statusText');
  if (statusTextEl) {
    statusTextEl.textContent = status;
    statusTextEl.className = status === 'OPEN' ? "text-emerald-600 font-bold" : "text-red-600 font-bold";
  }

  const maskedTextEl = document.getElementById('maskedText');
  if (maskedTextEl) {
    maskedTextEl.textContent = masked ? 'Masked' : 'Unmasked';
    maskedTextEl.className = masked ? "text-amber-600 font-bold" : "text-emerald-600 font-bold";
  }

  const maskBtnTitle = document.getElementById('maskBtnTitle');
  const maskBtnDesc = document.getElementById('maskBtnDesc');
  const maskIconContainer = document.getElementById('maskIconContainer');

  if (masked) {
    if (maskBtnTitle) maskBtnTitle.textContent = 'Unmask Names';
    if (maskBtnDesc) maskBtnDesc.textContent = 'Show candidate real names';
    if (maskIconContainer) maskIconContainer.innerHTML = '<i data-lucide="eye" class="w-6 h-6 text-white"></i>';
  } else {
    if (maskBtnTitle) maskBtnTitle.textContent = 'Mask Names';
    if (maskBtnDesc) maskBtnDesc.textContent = 'Hide candidate real names';
    if (maskIconContainer) maskIconContainer.innerHTML = '<i data-lucide="eye-off" class="w-6 h-6 text-white"></i>';
  }

  const stopBtn = document.getElementById('stopVotingBtn');
  if (stopBtn) {
    if (status === 'CLOSED') {
      stopBtn.disabled = true;
      stopBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      stopBtn.disabled = false;
      stopBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  if (window.lucide) {
    lucide.createIcons();
  }
}

function renderLiveSidebarWithCandidates(candidates) {
  const sidebar = document.getElementById('dynamicSidebarPositions');
  const candCountEl = document.getElementById('No.candidates');

  if (candCountEl) candCountEl.textContent = candidates.length.toLocaleString();

  // I-group ang candidates ayon sa position_title
  const grouped = {};
  candidates.forEach(c => {
    const posTitle = c.position_title || 'General Position';
    if (!grouped[posTitle]) grouped[posTitle] = [];
    grouped[posTitle].push(c);
  });

  if (sidebar) {
    sidebar.innerHTML = Object.keys(grouped).map((posTitle, pIdx) => {
      const cList = grouped[posTitle];
      const barsHTML = cList.map(c => `
        <div class="candidate-row flex flex-col w-full" data-candidate-id="${c.candidate_id}">
          <div class="flex justify-between items-center text-xs sm:text-sm font-serif font-semibold text-gray-800 leading-none mb-1">
            <span class="truncate pr-2">${escapeHtml(c.name)}</span>
            <span class="font-mono text-gray-900 shrink-0">0%</span>
          </div>
          <div class="w-full bg-gray-400/60 h-3 sm:h-3.5 rounded-full overflow-hidden shadow-inner">
            <div class="bg-[#8f0000] h-full rounded-full transition-all duration-500 ease-out" style="width: 0%;"></div>
          </div>
        </div>
      `).join('');

      return `
        <div class="position-section flex flex-col ${pIdx > 0 ? 'mt-2' : ''} gap-1.5 w-full">
          <div class="pl-1">
            <h4 class="text-[18px] sm:text-[20px] font-serif font-bold text-gray-900 leading-tight">
              ${escapeHtml(posTitle)}
            </h4>
          </div>
          <div class="candidates-list flex flex-col gap-2 pl-2 w-full">
            ${barsHTML}
          </div>
        </div>
      `;
    }).join('');
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* --- INITIALIZATION --- */
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  fetchElectionStatus();
  fetchPublicCandidatesAndResults();

  // Auto-refresh kada 5 segundo para updated ang dashboard status at candidates
  setInterval(() => {
    fetchElectionStatus();
    fetchPublicCandidatesAndResults();
  }, 5000);
});