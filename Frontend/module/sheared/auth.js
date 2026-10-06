(() => {
  const script = document.currentScript,
    base = new URL("../../", script.src),
    role = script.dataset.role;
    
  const api = "http://[::1]:3306/api";
  const pages = {
    adviser: "module/adviser/Adviser.html",
    committee: "module/committee/Committee.html",
    super_admin: "module/SuperAdmin/SuperAdmin.html",
  };
  const loginPages = {
    adviser: "module/adviser/Adviserlogin.html",
    committee: "module/committee/Committeelogin.html",
    super_admin: "module/SuperAdmin/SuperAdminlog.html",
  };
  async function request(route, options = {}) {
    const token = sessionStorage.getItem("voting_token");
    const response = await fetch(api + route, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...options.headers,
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        "The API returned an unexpected response (HTTP " + response.status +
        "). Check that the backend is running at " + api + " and reload this page.",
      );
    }
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("The backend returned invalid JSON (HTTP " + response.status + "). Restart the backend and reload this page.");
    }
    if (!response.ok) {
      const error = new Error(data.message || "Request failed");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  window.votingAuth = { request };
  if (script.dataset.mode === "login") {
    const form = document.getElementById("loginForm"),
      message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.setAttribute("aria-live", "polite");
    form.append(message);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Signing in...";
      message.textContent = "";
      try {
        const data = await request("/signin", {
          method: "POST",
          body: JSON.stringify({
            email: form.querySelector("#email").value.trim(),
            password: form.querySelector("#password").value,
            role,
          }),
        });
        sessionStorage.setItem("voting_token", data.token);
        sessionStorage.setItem("voting_user", JSON.stringify(data.user));
        location.replace(new URL(pages[data.user.role], base));
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
  } else {
    document.documentElement.style.visibility = "hidden";
    request("/signin/me")
      .then(({ user }) => {
        if (user.role !== role) {
          location.replace(new URL(pages[user.role] || "signin.html", base));
          return;
        }
        document.documentElement.style.visibility = "";
        const link = document.createElement("a");
        link.href = new URL("signin.html", base);
        link.textContent = "Log out";
        link.style.cssText =
          "position:fixed;bottom:16px;right:16px;z-index:100;background:#8f0000;color:white;padding:10px 16px;border-radius:8px";
        link.addEventListener("click", async (event) => {
          event.preventDefault();
          try {
            await request("/signin/logout", { method: "POST" });
          } catch {}
          sessionStorage.removeItem("voting_token");
          sessionStorage.removeItem("voting_user");
          location.replace(new URL("signin.html", base));
        });
        document.body.append(link);
      })
      .catch((error) => {
        if (error.status === 401 || error.status === 403) {
          sessionStorage.removeItem("voting_token");
          sessionStorage.removeItem("voting_user");
          location.replace(new URL(loginPages[role], base));
        } else {
          document.documentElement.style.visibility = "";
          document.body.replaceChildren(
            Object.assign(document.createElement("p"), {
              textContent:
                "Cannot verify your session. Check the backend connection and reload this page.",
            }),
          );
        }
      });
  }
})();
