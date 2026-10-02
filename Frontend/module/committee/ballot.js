const content = document.querySelector("#content");
const submit = document.querySelector("#add");
const update = document.querySelector("#update");

// POST API - Create New Election
submit.addEventListener("click", async () => {
    const title = document.querySelector("#electionTitle").value;
    const academic_year = document.querySelector("#academicYear").value;
    const start_date = document.querySelector("#startDate").value;
    const end_date = document.querySelector("#endDate").value;
    const status = document.querySelector("#status").value || "Upcoming";

    const formData = { title, academic_year, start_date, end_date, status };

    if (title && academic_year && start_date && end_date) {
        try {
            const response = await fetch("/api/elections", {
                method: "POST",
                body: JSON.stringify(formData),
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (response.ok) {
                alert("Election Created Successfully");
                location.reload();
            } else {
                const errData = await response.json();
                alert(errData.message || "Failed to create election.");
            }
        } catch (error) {
            console.error("Create election error:", error);
        }
    } else {
        alert("Please fill in all required fields.");
    }
});

// Load Election List on Page Load
window.addEventListener("load", () => {
    getElectionList();
});

// GET API - Read All Elections
function getElectionList() {
    let html = "";

    fetch("/api/elections")
        .then((response) => response.json())
        .then((data) => {
            const elections = data.elections || data;

            elections.forEach((element) => {
                const startDate = new Date(element.start_date);
                const endDate = new Date(element.end_date);

                const formattedStart = startDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                });

                const formattedEnd = endDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                });

                html += `
            <tr>
                <td class="px-4 py-2 font-medium">${element.title}</td>
                <td class="px-4 py-2">${element.academic_year}</td>
                <td class="px-4 py-2 text-xs">
                    <div>Start: ${formattedStart}</div>
                    <div>End: ${formattedEnd}</div>
                </td>
                <td class="px-4 py-2">
                    <span class="px-2 py-1 rounded text-xs font-bold ${
                        element.status === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                    }">${element.status}</span>
                </td>
                <td class="px-4 py-2 text-center">
                    <button onClick="updateElection(${element.election_id})" class="text-blue-600 hover:text-blue-800 mx-1">
                        <img src="./edit.png" class="w-5 h-5 inline hover:scale-110 transition-transform" alt="Edit">
                    </button>
                    <button onClick="deleteElection(${element.election_id})" class="text-red-600 hover:text-red-800 mx-1">
                        <img src="./bin.png" class="w-5 h-5 inline hover:scale-110 transition-transform" alt="Delete">
                    </button>
                </td>
            </tr>`;
            });
            content.innerHTML = html;
        })
        .catch((error) => {
            console.error("Fetch election list error:", error);
        });
}

// DELETE API - Remove Election
function deleteElection(id) {
    if (confirm("Are you sure you want to delete this election?")) {
        fetch(`/api/elections/${id}`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
            },
        })
            .then((response) => {
                if (response.ok) {
                    alert("Election Deleted Successfully");
                    location.reload();
                } else {
                    alert("Error Deleting Election");
                }
            })
            .catch((error) => console.error("Delete error:", error));
    }
}

// GET API by ID - Load Data into Form for Editing
function updateElection(id) {
    fetch(`/api/elections/${id}`)
        .then((response) => response.json())
        .then((data) => {
            const election = data.election || data[0] || data;

            submit.classList.add("hidden");
            update.classList.remove("hidden");

            const startDate = new Date(election.start_date).toISOString().slice(0, 16);
            const endDate = new Date(election.end_date).toISOString().slice(0, 16);

            document.querySelector("#electionTitle").value = election.title;
            document.querySelector("#academicYear").value = election.academic_year;
            document.querySelector("#startDate").value = startDate;
            document.querySelector("#endDate").value = endDate;
            document.querySelector("#status").value = election.status;
            document.querySelector("#ID").value = election.election_id;
        })
        .catch((error) => {
            console.error("Fetch single election error:", error);
        });
}

// PUT API - Update Election
update.addEventListener("click", () => {
    const title = document.querySelector("#electionTitle").value;
    const academic_year = document.querySelector("#academicYear").value;
    const start_date = document.querySelector("#startDate").value;
    const end_date = document.querySelector("#endDate").value;
    const status = document.querySelector("#status").value;
    const id = document.querySelector("#ID").value;

    const formData = { title, academic_year, start_date, end_date, status };

    fetch(`/api/elections/${id}`, {
        method: "PUT",
        body: JSON.stringify(formData),
        headers: {
            "Content-Type": "application/json",
        },
    })
        .then((response) => {
            if (response.ok) {
                alert("Election Updated Successfully");
                location.reload();
            } else {
                alert("Update Error.");
            }
        })
        .catch((error) => {
            console.error("Update error:", error);
        });
});