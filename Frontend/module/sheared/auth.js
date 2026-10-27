(() => {
  const script = document.currentScript;

  const base = new URL("../../", script.src);
  const role = script.dataset.role;

  const api = "https://voting-backend-cdrj.onrender.com/api";

  const pages = {
    adviser: "module/adviser/Adviser.html",
    committee: "module/committee/Committee.html",
    super_admin: "module/SuperAdmin/Manageacc.html"
  };

  const loginPages = {
    adviser: "module/adviser/Adviserlogin.html",
    committee: "module/committee/Committeelogin.html",
    super_admin: "module/SuperAdmin/SuperAdminlog.html"
  };

  const changePasswordPage =
    "module/change_password/change_password.html";

  function clearSession() {
    sessionStorage.removeItem("voting_token");
    sessionStorage.removeItem("voting_user");
    sessionStorage.removeItem("first_login_role");
  }

  async function request(route, options = {}) {
    const token = sessionStorage.getItem("voting_token");

    const response = await fetch(api + route, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: "Bearer " + token }
          : {}),
        ...(options.headers || {})
      }
    });

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new Error(
        "Unexpected API response (HTTP " +
        response.status +
        "). Check that the backend is running."
      );
    }

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        "The backend returned invalid JSON."
      );
    }

    if (!response.ok) {
      const error = new Error(
        data.message || "Request failed."
      );

      error.status = response.status;
      error.mustChangePassword =
        data.mustChangePassword === true;

      throw error;
    }

    return data;
  }

  window.votingAuth = { request };

  // LOGIN PAGE
  if (script.dataset.mode === "login") {
    const form = document.getElementById("loginForm");

    if (!form) {
      console.error("loginForm not found.");
      return;
    }

    const message = document.createElement("p");

    message.setAttribute("role", "alert");
    message.setAttribute("aria-live", "polite");

    form.append(message);

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const button = form.querySelector(
        'button[type="submit"]'
      );

      button.disabled = true;
      button.textContent = "Signing in...";
      message.textContent = "";

      try {
        const data = await request("/signin", {
          method: "POST",
          body: JSON.stringify({
            email: form
              .querySelector("#email")
              .value.trim(),
            password: form
              .querySelector("#password")
              .value,
            role
          })
        });

        sessionStorage.setItem(
          "voting_token",
          data.token
        );

        sessionStorage.setItem(
          "voting_user",
          JSON.stringify(data.user)
        );

        const targetRole =
          data.user.role === "super_admin"
            ? role
            : data.user.role;

        // FIRST-TIME LOGIN
        if (data.mustChangePassword === true) {
          sessionStorage.setItem(
            "first_login_role",
            role
          );

          location.replace(
            new URL(changePasswordPage, base)
          );

          return;
        }

        // NORMAL LOGIN
        location.replace(
          new URL(pages[targetRole], base)
        );

      } catch (error) {
        message.textContent =
          error instanceof TypeError
            ? "Cannot reach the server. Start the backend and try again."
            : error.message;

      } finally {
        button.disabled = false;
        button.textContent = "Log-in";
      }
    });

    return;
  }

  // PROTECTED DASHBOARD
  document.documentElement.style.visibility = "hidden";

  request("/signin/me")
    .then(({ user }) => {
      const hasAccess =
        user.role === role ||
        user.role === "super_admin";

      if (!hasAccess) {
        location.replace(
          new URL(
            pages[user.role] || "signin.html",
            base
          )
        );
        return;
      }

      document.documentElement.style.visibility = "";

      async function logout(event) {
        event.preventDefault();

        try {
          await request("/signin/logout", {
            method: "POST"
          });
        } catch (error) {
          console.warn(
            "Logout request failed:",
            error
          );
        }

        clearSession();

        location.replace(
          new URL(loginPages[role], base)
        );
      }

      // Existing sidebar logout
      const sidebarLogout =
        document.getElementById("logoutLink");

      if (sidebarLogout) {
        sidebarLogout.addEventListener(
          "click",
          logout
        );
      }

      // Existing logout elements from HTML.
      // No new floating button is created.
      document
        .querySelectorAll(
          ".floating-logout, .logout"
        )
        .forEach(element => {
          if (element !== sidebarLogout) {
            element.addEventListener(
              "click",
              logout
            );
          }
        });
    })
    .catch(error => {
      if (
        error.mustChangePassword ||
        (
          error.status === 403 &&
          error.message ===
          "Password change required."
        )
      ) {
        location.replace(
          new URL(changePasswordPage, base)
        );

        return;
      }

      if (
        error.status === 401 ||
        error.status === 403
      ) {
        clearSession();

        location.replace(
          new URL(loginPages[role], base)
        );

        return;
      }

      document.documentElement.style.visibility = "";

      document.body.replaceChildren(
        Object.assign(
          document.createElement("p"),
          {
            textContent:
              "Cannot verify your session. Check the backend connection and reload this page."
          }
        )
      );
    });
})();