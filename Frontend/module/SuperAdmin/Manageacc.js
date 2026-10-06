const content = document.querySelector("#accountsTableBody");
const submit = document.querySelector("#addAccountForm button[type='submit']");
const api = "http://[::1]:3306/api";

// Kumuha ng Auth Token mula sa localStorage
const getToken = () => localStorage.getItem("token");

// POST API - Create New Account (Adviser / Committee)
document.querySelector("#addAccountForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.querySelector("#userName").value.trim();
    const email = document.querySelector("#accountEmail").value.trim();
    const password = document.querySelector("#password").value.trim();
    const role = document.querySelector("#role").value.toLowerCase(); // 'adviser' o 'committee'

    const formData = { name, email, password, role };

    if (name && email && password && role) {
        try {
            const response = await fetch(`${API_BASE}/accounts`, {
                method: "POST",
                body: JSON.stringify(formData),
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${getToken()}`
                },
            });

            const data = await response.json();

            if (response.ok) {
                alert("Account Created Successfully");
                document.querySelector("#addAccountForm").reset();
                getAccountList();
            } else {
                alert(data.message || "Failed to create account.");
            }
        } catch (error) {
            console.error("Create account error:", error);
            alert("Error connecting to server.");
        }
    } else {
        alert("Please fill in all required fields.");
    }
});

// Load Account List on Page Load
window.addEventListener("load", () => {
    getAccountList();
});

// GET API - Read All Accounts
function getAccountList() {
    let html = "";

    fetch(`${API_BASE}/accounts`, {
        headers: {
            "Authorization": `Bearer ${getToken()}`
        }
    })
        .then((response) => {
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("Server returned non-JSON response.");
            }
            return response.json();
        })
        .then((data) => {
            const accounts = data.users || data;

            if (!accounts || accounts.length === 0) {
                content.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-500 font-serif">No registered accounts found.</td></tr>`;
                return;
            }

            accounts.forEach((element) => {
                html += `
            <tr class="hover:bg-red-50/50 transition border-b border-gray-100">
                <td class="py-3.5 px-4 whitespace-nowrap font-medium text-gray-900">${escapeHtml(element.name)}</td>
                <td class="py-3.5 px-4 whitespace-nowrap text-gray-400 font-mono italic">Protected (Hashed)</td>
                <td class="py-3.5 px-4 whitespace-nowrap font-medium text-gray-800 capitalize">${escapeHtml(element.role)}</td>
                <td class="py-3.5 px-4 whitespace-nowrap text-gray-600">${escapeHtml(element.email)}</td>
                <td class="py-3.5 px-4 whitespace-nowrap text-center">
                    <button onClick="deleteAccount(${element.id})" class="px-3 py-1 bg-red-700 hover:bg-red-800 text-white text-xs font-serif rounded transition shadow">
                        Delete
                    </button>
                </td>
            </tr>`;
            });
            content.innerHTML = html;
        })
        .catch((error) => {
            console.error("Fetch account list error:", error);
            content.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-red-600 font-serif">Failed to load accounts.</td></tr>`;
        });
}

// DELETE API - Remove Account
function deleteAccount(id) {
    if (confirm("Are you sure you want to delete this account?")) {
        fetch(`${API_BASE}/accounts/${id}`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
        })
            .then(async (response) => {
                const data = await response.json();
                if (response.ok) {
                    alert("Account Deleted Successfully");
                    getAccountList();
                } else {
                    alert(data.message || "Error Deleting Account");
                }
            })
            .catch((error) => console.error("Delete error:", error));
    }
}

// Helper to prevent XSS attacks
function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}