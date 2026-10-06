const api = "http://[::1]:3306/api";
const getToken = () => localStorage.getItem("token");

const getHeaders = () => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${getToken()}`
});

// Load Active Positions into Dropdown & Render Table
async function loadDashboardData() {
    try {
        const res = await fetch(`${API_BASE}/positions/election/current`, { headers: getHeaders() });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message || "Failed to fetch positions");

        const positions = data.positions || [];
        populatePositionDropdown(positions);
        renderCandidatesTable(positions);
        renderLiveResults(positions);
    } catch (err) {
        console.error("Error loading dashboard data:", err);
    }
}

function populatePositionDropdown(positions) {
    const select = document.getElementById("candPosition");
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Select Position</option>';
    positions.forEach(pos => {
        const opt = document.createElement("option");
        opt.value = pos.position_id;
        opt.textContent = pos.title;
        select.appendChild(opt);
    });
}

function renderCandidatesTable(positions) {
    const tableBody = document.getElementById("candidatesTableBody");
    if (!tableBody) return;

    let html = "";
    let totalCandidates = 0;

    if (positions.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-500 font-serif">No positions found.</td></tr>`;
        return;
    }

    positions.forEach(pos => {
        html += `
            <tr class="bg-[#efefef] text-black font-serif font-bold text-xs border-t border-b border-gray-300">
                <td colspan="5" class="py-2.5 px-4 text-[16px]">${escapeHtml(pos.title)}:</td>
            </tr>`;

        const candidates = pos.candidates || [];
        if (candidates.length === 0) {
            html += `
                <tr class="bg-white/80 border-b border-gray-200">
                    <td colspan="5" class="py-2.5 px-4 text-xs italic text-gray-400">No registered candidates for this position.</td>
                </tr>`;
        } else {
            candidates.forEach((cand, idx) => {
                totalCandidates++;
                const isEven = idx % 2 === 0;
                const rowClass = isEven ? "bg-[#8f0000] text-[#efefef]" : "bg-[#efefef] text-gray-900";
                const btnClass = isEven ? "bg-white/20 hover:bg-white/30 text-white" : "bg-[#8f0000] hover:bg-[#710000] text-white";

                html += `
                    <tr class="${rowClass} border-b border-gray-200 transition-colors">
                        <td class="py-2.5 px-4 font-serif text-[15px] whitespace-nowrap">${escapeHtml(cand.name)}</td>
                        <td class="py-2.5 px-4 font-serif text-[15px] whitespace-nowrap">${escapeHtml(cand.course || 'BSCS')}</td>
                        <td class="py-2.5 px-4 font-serif text-[15px] whitespace-nowrap">${escapeHtml(cand.grade_level || '1')}</td>
                        <td class="py-2.5 px-4 font-serif text-[15px] whitespace-nowrap">${escapeHtml(cand.party_list || 'Independent')}</td>
                        <td class="py-2.5 px-4 text-center">
                            <button onclick="deleteCandidate(${cand.candidate_id})" title="Delete Candidate" class="p-1.5 rounded ${btnClass} transition">
                                Delete
                            </button>
                        </td>
                    </tr>`;
            });
        }
    });

    tableBody.innerHTML = html;
    document.getElementById("No.candidates").textContent = totalCandidates;
}

function renderLiveResults(positions) {
    const sidebar = document.getElementById("dynamicSidebarPositions");
    if (!sidebar) return;

    sidebar.innerHTML = positions.map(pos => {
        const candidates = pos.candidates || [];
        const bars = candidates.map(cand => `
            <div class="candidate-row flex flex-col w-full">
                <div class="flex justify-between items-center text-xs font-serif font-semibold text-gray-800 mb-1">
                    <span class="truncate pr-2">${escapeHtml(cand.name)}</span>
                    <span class="font-mono text-gray-900">0%</span>
                </div>
                <div class="w-full bg-gray-400/60 h-3 rounded-full overflow-hidden">
                    <div class="bg-[#8f0000] h-full" style="width: 0%;"></div>
                </div>
            </div>
        `).join('');

        return `
            <div class="position-section flex flex-col gap-1.5 w-full">
                <h4 class="text-[18px] font-serif font-bold text-gray-900">${escapeHtml(pos.title)}</h4>
                <div class="flex flex-col gap-2 pl-2 w-full">${bars || '<div class="text-xs text-gray-400 italic">No candidates</div>'}</div>
            </div>`;
    }).join('');
}

// Handle Form Submit
document.getElementById("addCandidateForm")?.addEventListener("submit", async function (e) {
    e.preventDefault();

    const payload = {
        name: document.getElementById("candFullName").value.trim(),
        course: document.getElementById("candCourse").value.trim(),
        grade_level: document.getElementById("candGrade").value,
        party_list: document.getElementById("candParty").value.trim(),
        position_id: document.getElementById("candPosition").value
    };

    try {
        const res = await fetch(`${API_BASE}/candidates`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to add candidate");

        alert("Candidate added successfully!");
        this.reset();
        loadDashboardData();
    } catch (err) {
        alert("Error: " + err.message);
    }
});

// Delete Candidate Function
async function deleteCandidate(id) {
    if (!confirm("Are you sure you want to delete this candidate?")) return;

    try {
        const res = await fetch(`${API_BASE}/candidates/${id}`, {
            method: "DELETE",
            headers: getHeaders()
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to delete candidate");

        alert("Candidate deleted successfully!");
        loadDashboardData();
    } catch (err) {
        alert("Error: " + err.message);
    }
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener("DOMContentLoaded", loadDashboardData);