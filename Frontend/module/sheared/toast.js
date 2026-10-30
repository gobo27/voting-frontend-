
"use strict";

(function () {
    if (window.showToast && window.showConfirmToast) return;

    const style = document.createElement("style");

    style.textContent = `
        #campusToastContainer {
            position: fixed;
            top: 22px;
            right: 22px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: min(390px, calc(100vw - 32px));
            pointer-events: none;
        }

        .campus-toast {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            background: #ffffff;
            color: #252525;
            border: 1px solid #e5e7eb;
            border-left: 4px solid #800000;
            border-radius: 10px;
            padding: 14px 16px;
            box-shadow: 0 8px 28px rgba(0,0,0,.14);
            font: 14px/1.5 Arial, sans-serif;
            pointer-events: auto;
            animation: campusToastIn .25s ease;
        }

        .campus-toast.success {
            border-left-color: #16a34a;
        }

        .campus-toast.error {
            border-left-color: #dc2626;
        }

        .campus-toast.warning {
            border-left-color: #d97706;
        }

        .campus-toast.info {
            border-left-color: #800000;
        }

        .campus-toast-icon {
            font-size: 18px;
            font-weight: bold;
            flex-shrink: 0;
        }

        .campus-toast.success .campus-toast-icon {
            color: #16a34a;
        }

        .campus-toast.error .campus-toast-icon {
            color: #dc2626;
        }

        .campus-toast.warning .campus-toast-icon {
            color: #d97706;
        }

        .campus-toast.info .campus-toast-icon {
            color: #800000;
        }

        .campus-toast-message {
            flex: 1;
            overflow-wrap: anywhere;
        }

        .campus-toast-close {
            border: 0;
            background: transparent;
            color: #6b7280;
            cursor: pointer;
            font-size: 19px;
            padding: 0;
            line-height: 1;
        }

        .campus-toast.hide {
            opacity: 0;
            transform: translateX(20px);
            transition: opacity .25s ease,
                        transform .25s ease;
        }

        .campus-confirm-toast {
            border-left-color: #800000;
            display: block;
            padding: 18px;
        }

        .campus-confirm-heading {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }

        .campus-confirm-icon {
            width: 30px;
            height: 30px;
            border-radius: 8px;
            background: #fff0f1;
            color: #800000;
            display: grid;
            place-items: center;
            font-size: 19px;
            font-weight: bold;
            flex-shrink: 0;
        }

        .campus-confirm-title {
            font-size: 15px;
            font-weight: bold;
            color: #4a151b;
        }

        .campus-confirm-message {
            color: #4b5563;
            font-size: 13px;
            line-height: 1.6;
            margin: 0 0 18px;
            overflow-wrap: anywhere;
        }

        .campus-confirm-actions {
            display: flex;
            justify-content: flex-end;
            gap: 9px;
        }

        .campus-confirm-button {
            border: 1px solid #e5e7eb;
            border-radius: 7px;
            padding: 9px 14px;
            font: 600 13px Arial, sans-serif;
            cursor: pointer;
        }

        .campus-confirm-cancel {
            background: #f9fafb;
            color: #374151;
        }

        .campus-confirm-cancel:hover {
            background: #f3f4f6;
        }

        .campus-confirm-delete {
            background: #800000;
            color: white;
            border-color: #800000;
        }

        .campus-confirm-delete:hover {
            background: #650000;
        }

        .campus-confirm-button:focus-visible,
        .campus-toast-close:focus-visible {
            outline: 2px solid #b75d66;
            outline-offset: 2px;
        }

        @keyframes campusToastIn {
            from {
                opacity: 0;
                transform: translateX(20px);
            }

            to {
                opacity: 1;
                transform: translateX(0);
            }
        }

        @media print {
            #campusToastContainer {
                display: none !important;
            }
        }
    `;

    document.head.appendChild(style);

    function getContainer() {
        let container = document.getElementById(
            "campusToastContainer"
        );

        if (!container) {
            container = document.createElement("div");
            container.id = "campusToastContainer";
            container.setAttribute("aria-live", "polite");
            document.body.appendChild(container);
        }

        container.style.setProperty("display", "flex", "important");
        container.style.setProperty("position", "fixed", "important");
        container.style.setProperty("top", "22px", "important");
        container.style.setProperty("right", "22px", "important");
        container.style.setProperty("z-index", "2147483647", "important");
        container.style.setProperty("visibility", "visible", "important");
        container.style.setProperty("opacity", "1", "important");


        return container;
    }

    // ==========================================
    // REGULAR TOAST NOTIFICATION
    // ==========================================

    window.showToast = function (
        message,
        type = "info",
        duration = 4000
    ) {
        const allowed = [
            "success",
            "error",
            "warning",
            "info"
        ];

        if (!allowed.includes(type)) {
            type = "info";
        }

        const icons = {
            success: "✓",
            error: "✕",
            warning: "!",
            info: "ⓘ"
        };

        const container = getContainer();
        const toast = document.createElement("div");

        toast.className = `campus-toast ${type}`;

        toast.setAttribute(
            "role",
            type === "error" ? "alert" : "status"
        );

        const icon = document.createElement("span");
        icon.className = "campus-toast-icon";
        icon.textContent = icons[type];

        const content = document.createElement("div");
        content.className = "campus-toast-message";
        content.textContent = String(message);

        const close = document.createElement("button");
        close.className = "campus-toast-close";
        close.type = "button";
        close.textContent = "×";
        close.setAttribute(
            "aria-label",
            "Close notification"
        );

        let timer;
        let dismissed = false;

        function dismiss() {
            if (dismissed) return;
            dismissed = true;

            clearTimeout(timer);
            toast.classList.add("hide");

            setTimeout(() => toast.remove(), 250);
        }

        close.addEventListener("click", dismiss);

        toast.append(icon, content, close);
        container.appendChild(toast);

        if (duration > 0) {
            timer = setTimeout(dismiss, duration);
        }

        return toast;
    };

    // ==========================================
    // CONFIRMATION TOAST
    // ==========================================

    let activeConfirmation = null;

    window.showConfirmToast = function (
        message,
        options = {}
    ) {
        if (activeConfirmation) {
            return activeConfirmation;
        }

        const title = options.title || "Delete Account?";
        const confirmText =
            options.confirmText || "Delete Account";
        const cancelText =
            options.cancelText || "Cancel";

        const container = getContainer();

        const toast = document.createElement("div");
        toast.className =
            "campus-toast campus-confirm-toast";

        toast.setAttribute("role", "alertdialog");
        toast.setAttribute("aria-modal", "true");

        const heading = document.createElement("div");
        heading.className = "campus-confirm-heading";

        const icon = document.createElement("span");
        icon.className = "campus-confirm-icon";
        icon.textContent = "!";

        const headingText = document.createElement("strong");
        headingText.className = "campus-confirm-title";
        headingText.textContent = title;

        heading.append(icon, headingText);

        const description = document.createElement("p");
        description.className = "campus-confirm-message";
        description.textContent = String(message);

        const actions = document.createElement("div");
        actions.className = "campus-confirm-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className =
            "campus-confirm-button campus-confirm-cancel";
        cancelButton.textContent = cancelText;

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className =
            "campus-confirm-button campus-confirm-delete";
        confirmButton.textContent = confirmText;

        actions.append(cancelButton, confirmButton);
        toast.append(heading, description, actions);
        container.appendChild(toast);

        const previousFocus = document.activeElement;

        let resolveConfirmation;
        let finished = false;

        const promise = new Promise(resolve => {
            resolveConfirmation = resolve;
        });

        activeConfirmation = promise;

        function finish(confirmed) {
            if (finished) return;
            finished = true;

            document.removeEventListener(
                "keydown",
                handleKeydown,
                true
            );

            toast.remove();
            activeConfirmation = null;

            if (
                previousFocus &&
                typeof previousFocus.focus === "function" &&
                previousFocus.isConnected
            ) {
                previousFocus.focus();
            }

            resolveConfirmation(confirmed);
        }

        function handleKeydown(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                finish(false);
            }

            if (event.key === "Tab") {
                const target =
                    document.activeElement === cancelButton
                        ? confirmButton
                        : cancelButton;

                event.preventDefault();
                target.focus();
            }
        }

        cancelButton.addEventListener(
            "click",
            () => finish(false)
        );

        confirmButton.addEventListener(
            "click",
            () => finish(true)
        );

        document.addEventListener(
            "keydown",
            handleKeydown,
            true
        );

        cancelButton.focus();

        return promise;
    };
})();
