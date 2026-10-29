
"use strict";

const BallotAPI = (() => {
    const API_BASE = "https://voting-backend-cdrj.onrender.com/api";

    function getToken() {
        return sessionStorage.getItem("voting_token") ||
            localStorage.getItem("voting_token") ||
            localStorage.getItem("token");
    }

    async function request(path, options = {}) {
        const token = getToken();
        if (!token) throw new Error("Session not found. Please log in again.");

        let response;
        try {
            response = await fetch(API_BASE + path, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...(options.headers || {})
                }
            });
        } catch (error) {
            throw new Error("Cannot connect to backend: " + error.message);
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || data.error || `API error ${response.status}`);
        }
        return data;
    }

    async function getElections() {
        const result = await request("/election/current/status");
        return { elections: [result.election] };
    }

    async function resolveElection(requestedId = "current") {
        const result = await request(
            `/election/${encodeURIComponent(requestedId)}/status`
        );
        if (!result.election) throw new Error("Election not found.");
        return result.election;
    }

    async function getPositions(electionId) {
        return request(`/positions/election/${encodeURIComponent(electionId)}`);
    }

    async function addPosition(payload) {
        return request("/positions", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async function updatePosition(id, payload) {
        return request(`/positions/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
    }

    async function createTemplate(payload) {
        return request("/ballots/templates", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async function saveCompleteTemplate(payload) {
        return request("/ballots/templates/complete", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async function getTemplate(templateId) {
        return request(
            `/ballots/templates/${encodeURIComponent(templateId)}`
        );
    }

    async function getTemplates(electionId) {
        return request(
            `/ballots/templates/election/${encodeURIComponent(electionId)}`
        );
    }

    async function addGridCoordinate(templateId, payload) {
        return request(
            `/ballots/templates/${encodeURIComponent(templateId)}/coordinates`,
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );
    }

    async function deleteTemplate(templateId) {
        return request(
            `/ballots/templates/${encodeURIComponent(templateId)}`,
            { method: "DELETE" }
        );
    }

    async function generateQRBatch(payload) {
        return request("/ballots/qr/batches", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async function getQRBatches(electionId, templateId = null) {
        const params = new URLSearchParams();

        if (templateId !== null && templateId !== "") {
            params.set("template_id", String(templateId));
        }

        const query = params.toString();
        return request(
            `/ballots/qr/batches/election/${encodeURIComponent(electionId)}` +
            (query ? `?${query}` : "")
        );
    }

    async function getQRBatch(batchId) {
        return request(
            `/ballots/qr/batches/${encodeURIComponent(batchId)}`
        );
    }

    async function confirmPrint(batchId, printType, quantity, eventId) {
        return request(
            `/ballots/qr/batches/${encodeURIComponent(batchId)}/confirm-print`,
            {
                method: "POST",
                body: JSON.stringify({
                    event_id: eventId,
                    print_type: printType,
                    quantity
                })
            }
        );
    }

    async function confirmQRPrint(batchId, payload) {
        return request(
            `/ballots/qr/batches/${encodeURIComponent(batchId)}/confirm-print`,
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );
    }

    async function getPrintSummary(electionId) {
        return request(
            `/ballots/qr/print-summary/election/${encodeURIComponent(electionId)}`
        );
    }

    return {
        request,
        getElections,
        resolveElection,
        getPositions,
        addPosition,
        updatePosition,
        createTemplate,
        saveCompleteTemplate,
        getTemplate,
        getTemplates,
        addGridCoordinate,
        deleteTemplate,
        generateQRBatch,
        getQRBatches,
        getQRBatch,
        confirmPrint,
        confirmQRPrint,
        getPrintSummary
    };
})();

window.BallotAPI = BallotAPI;
