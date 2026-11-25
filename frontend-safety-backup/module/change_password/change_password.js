"use strict";

(() => {
    const API_BASE = "http://localhost:3000/api";

    const role =
        sessionStorage.getItem("first_login_role") ||
        "adviser";

    const loginPages = {
        adviser: "../adviser/Adviserlogin.html",
        committee: "../committee/Committeelogin.html",
        super_admin: "../SuperAdmin/SuperAdminlog.html"
    };

    const loginUrl =
        loginPages[role] || loginPages.adviser;

    const token =
        sessionStorage.getItem("voting_token");

    const form =
        document.getElementById("changeForm");

    const message =
        document.getElementById("message");

    const saveButton =
        document.getElementById("saveButton");

    const backButton =
        document.getElementById("backToLogin");

    function clearSession() {
        sessionStorage.removeItem("voting_token");
        sessionStorage.removeItem("voting_user");
        sessionStorage.removeItem("first_login_role");
    }

    function goToLogin() {
        clearSession();
        location.replace(loginUrl);
    }

    backButton.addEventListener(
        "click",
        goToLogin
    );

    // Must first log in with temporary password.
    if (!token) {
        message.textContent =
            "Please log in with your temporary password first.";

        saveButton.disabled = true;
        return;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const newPassword =
            document.getElementById("newPassword").value;

        const confirmPassword =
            document.getElementById("confirmPassword").value;

        if (newPassword !== confirmPassword) {
            message.textContent =
                "Passwords do not match.";
            return;
        }

        if (
            newPassword.length < 12 ||
            newPassword.length > 128
        ) {
            message.textContent =
                "Password must contain 12–128 characters.";
            return;
        }

        saveButton.disabled = true;
        saveButton.textContent = "Updating...";

        message.textContent =
            "Updating password...";

        try {
            const response = await fetch(
                API_BASE + "/signin/first-password/change",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer " + token
                    },
                    body: JSON.stringify({
                        newPassword,
                        confirmPassword
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message ||
                    "Unable to update password."
                );
            }

            clearSession();

            if (typeof window.showToast === "function") {
                window.showToast(
                    "Password changed successfully! Redirecting to login...",
                    "success"
                );
            } else {
                message.textContent =
                    "Password changed successfully! Redirecting to login...";
            }

            // Wait 2 seconds para makita ang toast
            setTimeout(() => {
                location.replace(loginUrl);
            }, 2000);

            location.replace(loginUrl);

        } catch (error) {
            message.textContent = error.message;

            saveButton.disabled = false;
            saveButton.textContent = "Update Password";
        }
    });
})();