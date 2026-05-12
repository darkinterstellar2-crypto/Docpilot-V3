document.addEventListener('DOMContentLoaded', () => {
    
    // --- LOGIN LOGIC ---
    const loginForm = document.getElementById('loginForm');
    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        const identifier = document.getElementById('loginId').value; // Grabs username OR email
        const password = document.getElementById('loginPass').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password }) // Sent as identifier
            });

            const result = await response.json();
            if (result.success && result.requires2FA) {
                // Superadmin 2FA — show OTP input
                show2FAInput(result.email);
            } else if (result.success) {
                completeLogin(result);
            } else {
                alert(result.message);
            }
        } catch (error) { alert("Failed: " + error.message); }
    });

    function completeLogin(result) {
        localStorage.setItem('userRole', result.role);
        localStorage.setItem('userName', result.name);
        localStorage.setItem('userEmail', result.email);
        if (result.token) localStorage.setItem('authToken', result.token);
        window.location.href = 'index.html';
    }

    function show2FAInput(email) {
        const form = document.getElementById('loginForm');
        form.innerHTML = `
            <div style="text-align:center; margin-bottom: 16px;">
                <div style="font-size: 40px;">🔐</div>
                <h3 style="font-size: 16px; font-weight: 700; color: #111; margin: 8px 0 4px;">Two-Factor Verification</h3>
                <p style="font-size: 12px; color: #888;">A verification code was sent to your email.</p>
            </div>
            <div>
                <input type="text" id="twoFACode" required placeholder="Enter 6-digit code"
                    maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code"
                    style="width:100%; text-align:center; font-size:24px; letter-spacing:8px; font-weight:700; font-family:monospace;"
                    class="input-field px-4 py-3 rounded-xl text-gray-900">
            </div>
            <button type="submit" class="w-full py-3 rounded-xl text-sm font-bold text-white transition-all"
                style="background: #111; margin-top: 12px;">
                Verify & Login
            </button>
            <p id="twoFAError" style="color:#dc2626; font-size:12px; text-align:center; margin-top:8px; display:none;"></p>
            <p style="font-size:11px; color:#999; text-align:center; margin-top:12px;">Code expires in 5 minutes</p>
        `;

        form.onsubmit = async (e) => {
            e.preventDefault();
            const otp = document.getElementById('twoFACode').value.trim();
            const errEl = document.getElementById('twoFAError');
            if (!otp || otp.length !== 6) {
                errEl.textContent = 'Please enter the 6-digit code.';
                errEl.style.display = 'block';
                return;
            }
            try {
                const res = await fetch('/api/verify-2fa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, otp })
                });
                const result = await res.json();
                if (result.success) {
                    completeLogin(result);
                } else {
                    errEl.textContent = result.message;
                    errEl.style.display = 'block';
                }
            } catch (err) {
                errEl.textContent = 'Verification failed: ' + err.message;
                errEl.style.display = 'block';
            }
        };

        document.getElementById('twoFACode').focus();
    }

    // --- REGISTRATION & OTP LOGIC ---
    const registerForm = document.getElementById('registerForm');
    const otpForm = document.getElementById('otpForm');
    let registeredEmail = "";

    // STEP 1: Submit Registration
    registerForm?.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        registeredEmail = document.getElementById('regEmail').value;

        const userData = {
            name: document.getElementById('regName').value,
            username: document.getElementById('regUser').value,
            email: registeredEmail,
            password: document.getElementById('regPass').value
            // role is always set to 'user' by the server — no client-side role selection
        };

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });

            const result = await response.json();
            if (result.success) {
                // Hide Registration form, Show OTP form
                registerForm.classList.add('hidden');
                otpForm.classList.remove('hidden');
                document.getElementById('formTitle').innerText = "Verify Email";
            } else {
                alert(result.message);
            }
        } catch (error) { alert("Failed: " + error.message); }
    });

    // STEP 2: Submit OTP
    otpForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const otpCode = document.getElementById('otpCode').value;

        try {
            const response = await fetch('/api/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: registeredEmail, otp: otpCode })
            });

            const result = await response.json();
            if (result.success) {
                alert(result.message); // "Email verified! Waiting for admin approval."
                window.location.href = 'login.html'; 
            } else {
                alert(result.message);
            }
        } catch (error) { alert("Failed: " + error.message); }
    });
});