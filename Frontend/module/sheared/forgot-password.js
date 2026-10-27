
"use strict";

(() => {
    const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
    const TEST_EMAIL = "vmaldea27@gmail.com";

    const forgotBtn = document.getElementById("forgotPasswordBtn");
    if (!forgotBtn) return;

    const style = document.createElement("style");
    style.textContent = `
        .reset-overlay {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(0, 0, 0, .55);
        }

        .reset-overlay.open {
            display: flex;
        }

        .reset-card {
            width: 100%;
            max-width: 420px;
            max-height: 90vh;
            overflow-y: auto;
            background: #fff;
            border-radius: 14px;
            padding: 28px;
            box-shadow: 0 15px 50px #0003;
            font-family: Arial, sans-serif;
            color: #222;
        }

        .reset-card h2 {
            margin: 0 0 8px;
            color: #800000;
            font-size: 22px;
        }

        .reset-card p {
            font-size: 13px;
            line-height: 1.6;
            color: #666;
        }

        .reset-card label {
            display: block;
            margin: 18px 0 7px;
            font-weight: bold;
            font-size: 13px;
        }

        .reset-card input {
            display: block;
            width: 100%;
            padding: 12px;
            border: 1px solid #ccc;
            border-radius: 8px;
            font-size: 14px;
            box-sizing: border-box;
        }

        .reset-card input:focus {
            outline: 2px solid #80000055;
            border-color: #800000;
        }

        .reset-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }

        .reset-actions button {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            cursor: pointer;
        }

        .reset-primary {
            background: #800000;
            color: #fff;
        }

        .reset-secondary {
            background: #e5e7eb;
            color: #222;
        }

        .reset-actions button:disabled {
            opacity: .55;
            cursor: wait;
        }

        .reset-message {
            margin-top: 15px;
            font-size: 13px;
            line-height: 1.5;
            min-height: 18px;
        }

        .reset-message.error {
            color: #b91c1c;
        }

        .reset-message.success {
            color: #166534;
        }

        .reset-step {
            display: none;
        }

        .reset-step.active {
            display: block;
        }

        .reset-otp {
            text-align: center;
            letter-spacing: 8px;
            font-size: 22px !important;
            font-weight: bold;
        }

        .reset-hint {
            font-size: 12px;
            color: #777;
            margin-top: 12px;
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "reset-overlay";

    overlay.innerHTML = `
        <div class="reset-card"
             role="dialog"
             aria-modal="true"
             aria-labelledby="resetTitle">

            <h2 id="resetTitle">Forgot Password</h2>
            <p id="resetDescription">
                Reset your CampusVote password securely.
            </p>

            <form id="resetRequestForm" class="reset-step active">
                <label for="resetEmail">Registered Email</label>
                <input
                    id="resetEmail"
                    type="email"
                    autocomplete="email"
                    required
                    placeholder="Enter registered email"
                >

                <p class="reset-hint">
                    Testing is currently limited to the
                    designated CampusVote account.
                </p>

                <div class="reset-actions">
                    <button type="button"
                            class="reset-secondary reset-close">
                        Cancel
                    </button>
                    <button type="submit" class="reset-primary">
                        Send OTP
                    </button>
                </div>
            </form>

            <form id="resetVerifyForm" class="reset-step">
                <p>
                    Enter the 6-digit code sent to your
                    registered test inbox.
                </p>

                <label for="resetOtp">Verification Code</label>
                <input
                    id="resetOtp"
                    class="reset-otp"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    pattern="[0-9]{6}"
                    placeholder="000000"
                    required
                >

                <div class="reset-actions">
                    <button type="button"
                            class="reset-secondary reset-back">
                        Back
                    </button>
                    <button type="submit" class="reset-primary">
                        Verify OTP
                    </button>
                </div>
            </form>

            <form id="resetConfirmForm" class="reset-step">
                <p>
                    OTP verified. Create your new password.
                </p>

                <label for="resetPassword">New Password</label>
                <input
                    id="resetPassword"
                    type="password"
                    autocomplete="new-password"
                    minlength="12"
                    maxlength="128"
                    required
                >

                <label for="resetConfirmPassword">
                    Confirm New Password
                </label>
                <input
                    id="resetConfirmPassword"
                    type="password"
                    autocomplete="new-password"
                    minlength="12"
                    maxlength="128"
                    required
                >

                <p class="reset-hint">
                    Use at least 12 characters.
                </p>

                <div class="reset-actions">
                    <button type="submit" class="reset-primary">
                        Save New Password
                    </button>
                </div>
            </form>

            <div id="resetMessage"
                 class="reset-message"
                 role="status"
                 aria-live="polite"></div>

        </div>
    `;

    document.body.appendChild(overlay);

    const $ = id => document.getElementById(id);

    let resetEmail = "";
    let resetToken = "";

    function showMessage(message, error = false) {
        const box = $("resetMessage");
        box.textContent = message;
        box.className =
            "reset-message " + (error ? "error" : "success");
    }

    function showStep(stepId) {
        document.querySelectorAll(".reset-step").forEach(step => {
            step.classList.toggle(
                "active",
                step.id === stepId
            );
        });

        showMessage("");
    }

    function closeModal() {
        overlay.classList.remove("open");
        resetEmail = "";
        resetToken = "";
        $("resetRequestForm").reset();
        $("resetVerifyForm").reset();
        $("resetConfirmForm").reset();
        showStep("resetRequestForm");
    }

    async function post(path, payload) {
        const response = await fetch(API_BASE + path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.message || "Request failed."
            );
        }

        return data;
    }

    async function submitWithLoading(form, callback) {
        const button = form.querySelector(
            'button[type="submit"]'
        );

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Please wait...";

        try {
            await callback();
        } catch (error) {
            showMessage(
                error instanceof TypeError
                    ? "Cannot connect to the backend."
                    : error.message,
                true
            );
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    forgotBtn.addEventListener("click", () => {
        overlay.classList.add("open");
        $("resetEmail").value =
            document.getElementById("email")?.value.trim() || "";
        $("resetEmail").focus();
    });

    overlay.querySelector(".reset-close")
        .addEventListener("click", closeModal);

    overlay.querySelector(".reset-back")
        .addEventListener("click", () => {
            resetToken = "";
            showStep("resetRequestForm");
        });

    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeModal();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" &&
            overlay.classList.contains("open")) {
            closeModal();
        }
    });

    $("resetRequestForm").addEventListener("submit", async event => {
        event.preventDefault();

        await submitWithLoading(event.currentTarget, async () => {
            const email = $("resetEmail").value.trim().toLowerCase();

            // Restrict the testing interface to the test account.
            // The backend also enforces this restriction.
            if (email !== TEST_EMAIL) {
                showMessage(
                    "If this account is eligible, a verification code will be sent."
                );
                return;
            }

            await post("/signin/password-reset/request", {
                email
            });

            resetEmail = email;
            showStep("resetVerifyForm");
            showMessage(
                "If eligible, an OTP has been sent. Check your test inbox."
            );
            $("resetOtp").focus();
        });
    });

    $("resetVerifyForm").addEventListener("submit", async event => {
        event.preventDefault();

        await submitWithLoading(event.currentTarget, async () => {
            const otp = $("resetOtp").value.trim();

            if (!/^[0-9]{6}$/.test(otp)) {
                throw new Error("Enter a valid 6-digit OTP.");
            }

            const result = await post(
                "/signin/password-reset/verify",
                {
                    email: resetEmail,
                    otp
                }
            );

            resetToken = result.resetToken;
            $("resetOtp").value = "";

            showStep("resetConfirmForm");
            $("resetPassword").focus();
        });
    });

    $("resetConfirmForm").addEventListener("submit", async event => {
        event.preventDefault();

        await submitWithLoading(event.currentTarget, async () => {
            const password = $("resetPassword").value;
            const confirmation =
                $("resetConfirmPassword").value;

            if (password.length < 12) {
                throw new Error(
                    "Password must have at least 12 characters."
                );
            }

            if (password !== confirmation) {
                throw new Error("Passwords do not match.");
            }

            await post("/signin/password-reset/confirm", {
                email: resetEmail,
                resetToken,
                password
            });

            closeModal();

            window.showToast(
                "Password updated successfully. Please log in with your new password.",
                "success",
                4000
            );
        });
    });
})();
