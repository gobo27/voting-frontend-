
const BallotAPI = (() => {
    const API_BASE = "http://localhost:3000/api";

    function getToken() {
        return (
            sessionStorage.getItem("voting_token") ||
            localStorage.getItem("voting_token") ||
            localStorage.getItem("token")
        );
    }

    async function request(path, options = {}) {
        const token = getToken();

        if (!token) {
            throw new Error("Please log in again.");
        }

        let response;

        try {
            response = await fetch(API_BASE + path, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...options.headers
                }
            });
        } catch (error) {
            throw new Error(
                "Cannot connect to backend at " + API_BASE
            );
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.message || `API error ${response.status}`
            );
        }

        return data;
    }

    async function getElections() {
        const result = await request("/election/1/status");

        return {
            elections: [result.election]
        };
    }

    async function resolveElection(requestedId) {
        const electionId = requestedId || "1";

        const result = await request(
            `/election/${encodeURIComponent(electionId)}/status`
        );

        if (!result.election) {
            throw new Error("Election not found");
        }

        return result.election;
    }

    async function getPositions(electionId) {
        return request(
            `/positions/election/${encodeURIComponent(electionId)}`
        );
    }

    async function addPosition(payload) {
        return request("/positions", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async function updatePosition(id, payload) {
        return request(
            `/positions/${encodeURIComponent(id)}`,
            {
                method: "PATCH",
                body: JSON.stringify(payload)
            }
        );
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
        addGridCoordinate
    };
})();
