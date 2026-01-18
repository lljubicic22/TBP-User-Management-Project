const API_URL = 'http://localhost:5000/api';
let currentUser = null;

let cachedUsers = [];
let cachedRoles = [];

document.addEventListener('DOMContentLoaded', function () {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', login);
    }

    const roleUserSelect = document.getElementById('roleUserSelect');
    if (roleUserSelect) {
        roleUserSelect.addEventListener('change', refreshAssignableRoles);
        loadUsersWithRoles();
        loadRoles();
        renderCurrentUserBadge();
    }
});

function showMessage(elId, type, text) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = type;
    el.textContent = text;
}

async function login() {
    const username = document.getElementById('username')?.value.trim();
    const password = document.getElementById('password')?.value;
    const btn = document.querySelector('#loginBtn, .btn');

    if (!username || !password) {
        showMessage('message', 'error', 'Enter username and password!');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Logging in...';
    }
    showMessage('message', 'success', 'Checking credentials...');

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (response.ok && data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user_id', data.userid);
            localStorage.setItem('roles', JSON.stringify(data.roles || []));
            localStorage.setItem('username', data.username || username);
            currentUser = { id: data.userid };
            showMessage('message', 'success', 'Login successful! Redirecting...');
            setTimeout(() => window.location.href = 'index.html', 800);
        } else {
            showMessage('message', 'error', data.error || 'Invalid username/password!');
        }
    } catch (error) {
        console.error('Login error:', error);
        showMessage('message', 'error', 'Error: Check Flask server on port 5000!');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Log In';
        }
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter') login();
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user_id');
    currentUser = null;
    window.location.href = 'login.html';
}

function getAuthHeader() {
    const token = localStorage.getItem('token');
    return token ? { 'x-access-token': token } : {};
}

function formatDateTime(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('en-GB', { timeZone: 'Europe/Zagreb' });
}

function rolesToText(rolesJson) {
    try {
        if (!rolesJson) return '';
        if (typeof rolesJson === 'string') {
            const arr = JSON.parse(rolesJson);
            return arr.map(x => x.role_name).join(', ');
        }
        if (Array.isArray(rolesJson)) {
            return rolesJson.map(x => x.role_name).join(', ');
        }
        return '';
    } catch (e) {
        return '';
    }
}

function loadUsersWithRoles() {
    fetch(`${API_URL}/users/with-roles`)
        .then(r => r.json())
        .then(data => {
            cachedUsers = data;
            const body = document.getElementById('usersBody');
            body.innerHTML = '';

            if (!data || data.length === 0) {
                body.innerHTML = '<tr><td colspan="7">No users found</td></tr>';
                refreshUserDropdowns();
                return;
            }

            const roles = JSON.parse(localStorage.getItem('roles') || '[]');
            const isAdminOrManager = roles.includes('Administrator') || roles.includes('Manager');

            data.forEach(u => {
                const row = document.createElement('tr');
                const roleText = rolesToText(u.roles);

                let actionsHtml = `
                    <button class="btn btn-small" onclick="viewUser(${u.id})">View</button>
                `;

                if (isAdminOrManager) {
                    actionsHtml += `
                        <button class="btn btn-small btn-warn" onclick="prefillEdit(${u.id})">Edit</button>
                        <button class="btn btn-small btn-danger" onclick="deleteUser(${u.id})">Delete</button>
                    `;
                }

                row.innerHTML = `
                    <td>${actionsHtml}</td>
                    <td>${u.id}</td>
                    <td>${u.username}</td>
                    <td>${u.email}</td>
                    <td>${u.status}</td>
                    <td>${formatDateTime(u.created_at)}</td>
                    <td>${roleText}</td>
                `;
                body.appendChild(row);
            });
            refreshUserDropdowns(data);
        })
        .catch(err => {
            console.error(err);
            showMessage('usersMessage', 'error', 'Error while loading users.');
        });
}

function refreshUserDropdowns(users) {
    users = users || cachedUsers || [];
    const selects = ['roleUserSelect', 'permUserSelect'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.username} (#${u.id})`;
            sel.appendChild(opt);
        });
    });

    refreshAssignableRoles();
}

function loadRoles() {
    fetch(API_URL + '/roles')
        .then(r => r.json())
        .then(data => {
            cachedRoles = data;
            refreshAssignableRoles();
        })
        .catch(err => {
            console.error(err);
        });
}

function renderCurrentUserBadge() {
    const el = document.getElementById('currentUser');
    if (!el) return;
    const username = localStorage.getItem('username') || '';
    const userId = localStorage.getItem('user_id') || localStorage.getItem('userid') || '';
    const roles = JSON.parse(localStorage.getItem('roles') || '[]');
    const roleText = Array.isArray(roles) ? roles.join(', ') : '';
    el.textContent = username ? `Logged in: ${username} (#${userId})${roleText ? ' — ' + roleText : ''}` : '';
}

function getUserRoleNamesFromCached(userId) {
    const u = (cachedUsers || []).find(x => String(x.id) === String(userId));
    if (!u || !u.roles) return [];
    try {
        const arr = typeof u.roles === 'string' ? JSON.parse(u.roles) : u.roles;
        if (!Array.isArray(arr)) return [];
        return arr.map(r => r.role_name).filter(Boolean);
    } catch {
        return [];
    }
}

function refreshAssignableRoles() {
    const userSel = document.getElementById('roleUserSelect');
    const roleSel = document.getElementById('roleSelect');
    if (!userSel || !roleSel) return;

    const userId = userSel.value;
    roleSel.innerHTML = '';

    if (!userId) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Select user first...';
        roleSel.appendChild(opt);
        roleSel.disabled = true;
        return;
    }

    const alreadyHas = new Set(getUserRoleNamesFromCached(userId));
    const missing = (cachedRoles || []).filter(r => !alreadyHas.has(r.role_name));

    if (missing.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'User already has all roles';
        roleSel.appendChild(opt);
        roleSel.disabled = true;
        return;
    }

    missing.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.role_id;
        opt.textContent = r.role_name;
        roleSel.appendChild(opt);
    });
    roleSel.disabled = false;
}

function createUser(event) {
    event.preventDefault();

    const roleValue = document.getElementById('createRole').value;
    const roles = roleValue ? [parseInt(roleValue)] : [];

    const userData = {
        username: document.getElementById('username').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        street: document.getElementById('street').value,
        house_number: document.getElementById('house_number')?.value,
        city: document.getElementById('city').value,
        postal_code: document.getElementById('postal_code')?.value,
        country: document.getElementById('country')?.value,
        mobile: document.getElementById('mobile').value,
        roles: roles
    };

    fetch(API_URL + '/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
    })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(res => {
            if (res.ok) {
                showMessage('createResult', 'success', `User "${userData.username}" created with ${roles.length ? roles.length + ' role(s)' : 'no role'}!`);
                document.getElementById('userForm').reset();
                document.getElementById('createRole').value = '';
                loadUsersWithRoles();
            } else {
                showMessage('createResult', 'error', 'Error: ' + (res.body.error || 'Unknown error'));
            }
        })
        .catch(err => {
            console.error(err);
            showMessage('createResult', 'error', 'Error while creating user.');
        });
}

function viewUser(userId) {
    fetch(API_URL + '/users/' + userId)
        .then(r => r.json())
        .then(data => {
            const u = data.user || {};
            const roles = data.roles || [];
            const md = data.metadata || {};

            document.getElementById('detailId').textContent = u.id ?? '';
            document.getElementById('detailUsername').textContent = u.username ?? '';
            document.getElementById('detailEmail').textContent = u.email ?? '';
            document.getElementById('detailStatus').textContent = u.status ?? '';
            document.getElementById('detailCreated').textContent = formatDateTime(u.created_at);
            document.getElementById('detailUpdated').textContent = formatDateTime(u.updated_at);

            const rolesUl = document.getElementById('detailRoles');
            rolesUl.innerHTML = '';
            if (roles.length === 0) {
                const li = document.createElement('li');
                li.textContent = '(no roles)';
                rolesUl.appendChild(li);
            } else {
                roles.forEach(r => {
                    const li = document.createElement('li');
                    li.textContent = r.role_name;
                    rolesUl.appendChild(li);
                });
            }

            const mdDiv = document.getElementById('detailMetadata');
            const keys = Object.keys(md);
            if (keys.length === 0) {
                mdDiv.textContent = '(no metadata)';
            } else {
                mdDiv.innerHTML = '';
                keys.forEach(k => {
                    const line = document.createElement('div');
                    line.textContent = k + ': ' + md[k];
                    mdDiv.appendChild(line);
                });
            }

            document.getElementById('userModal').style.display = 'block';
            loadUserDetails(userId);
        })
        .catch(err => {
            console.error(err);
            alert('Error while loading user details.');
        });
}

function closeModal() {
    document.getElementById('userModal').style.display = 'none';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

function prefillEdit(userId) {
    const u = cachedUsers.find(x => x.id === userId);
    if (!u) {
        alert('User not found in list.');
        return;
    }

    document.getElementById('editUserId').value = userId;
    document.getElementById('editUsername').value = u.username || '';
    document.getElementById('editEmail').value = u.email || '';
    document.getElementById('editStatus').value = '';

    document.getElementById('editResult').textContent = '';
    document.getElementById('editResult').className = '';

    document.getElementById('editModal').style.display = 'block';
}

function submitEditModal(event) {
    event.preventDefault();

    const userId = document.getElementById('editUserId').value;

    const payload = {};
    const username = document.getElementById('editUsername').value.trim();
    const email = document.getElementById('editEmail').value.trim();
    const status = document.getElementById('editStatus').value;

    if (username) payload.username = username;
    if (email) payload.email = email;
    if (status) payload.status = status;

    fetch(API_URL + '/users/' + userId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(res => {
            if (res.ok) {
                showMessage('editResult', 'success', 'User updated successfully.');
                loadUsersWithRoles();
                loadAuditLog();
                setTimeout(() => { closeEditModal(); }, 500);
            } else {
                showMessage('editResult', 'error', 'Error: ' + (res.body.error || 'Unknown error'));
            }
        })
        .catch(err => {
            console.error(err);
            showMessage('editResult', 'error', 'Error while updating user.');
        });
}

function deleteUser(userId) {
    const ok = confirm('Are you sure you want to delete (deactivate) this user?');
    if (!ok) return;

    fetch(API_URL + '/users/' + userId, { method: 'DELETE' })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(res => {
            if (res.ok) {
                showMessage('usersMessage', 'success', 'User deactivated.');
                loadUsersWithRoles();
                loadAuditLog();
            } else {
                showMessage('usersMessage', 'error', 'Error: ' + (res.body.error || 'Unknown error'));
            }
        })
        .catch(err => {
            console.error(err);
            showMessage('usersMessage', 'error', 'Error while deleting user.');
        });
}

function assignRole(event) {
    event.preventDefault();

    const userId = document.getElementById('roleUserSelect').value;
    const roleId = document.getElementById('roleSelect').value;

    if (!userId || !roleId) {
        showMessage('roleResult', 'error', 'Please select a user and a role.');
        return;
    }

    const roleData = {
        role_id: parseInt(roleId, 10),
        assigned_by: parseInt(localStorage.getItem('user_id') || localStorage.getItem('userid') || '1', 10)
    };

    fetch(API_URL + '/users/' + userId + '/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleData)
    })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(res => {
            if (res.ok) {
                showMessage('roleResult', 'success', res.body.message || 'Role assigned.');
                refreshAssignableRoles();
                loadUsersWithRoles();
                loadAuditLog();
            } else {
                showMessage('roleResult', 'error', 'Error: ' + (res.body.error || 'Unknown error'));
            }
        })
        .catch(err => {
            console.error(err);
            showMessage('roleResult', 'error', 'Error while assigning role.');
        });
}

function loadUserPermissions() {
    const userId = document.getElementById('permUserSelect').value;
    if (!userId) return;

    fetch(`${API_URL}/users/${userId}/permissions`)
        .then(r => r.json())
        .then(perms => {
            document.getElementById('userPermissions').innerHTML =
                perms.map(p => `<div>${p.permission_name} (${p.resource_type})</div>`).join('');
        });
}

function loadAuditLog() {
    fetch(API_URL + '/audit-log')
        .then(r => r.json())
        .then(data => {
            const body = document.getElementById('auditBody');
            body.innerHTML = '';

            if (!data || data.length === 0) {
                body.innerHTML = '<tr><td colspan="6">No audit log entries</td></tr>';
                return;
            }

            data.forEach(l => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${l.log_id}</td>
                    <td>${l.table_name}</td>
                    <td>${l.operation}</td>
                    <td>${l.user_id || ''}</td>
                    <td>${l.username || ''}</td>
                    <td>${formatDateTime(l.changed_at)}</td>
                `;
                body.appendChild(row);
            });
        })
        .catch(err => {
            console.error(err);
        });
}

function uploadProfilePicture() {
    const userId = document.getElementById('editUserId').value;
    const fileInput = document.getElementById('editProfilePic');

    if (!fileInput.files[0]) {
        alert('Please select a file first');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    fetch(`${API_URL}/users/${userId}/profile-picture`, {
        method: 'POST',
        body: formData
    })
        .then(r => r.json())
        .then(data => {
            if (data.message) {
                alert('Profile picture uploaded!');
                loadUserDetails(userId);
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
            }
        })
        .catch(err => alert('Upload failed: ' + err));
}

function deleteProfilePicture() {
    const userId = document.getElementById('editUserId').value;

    if (!confirm('Delete profile picture?')) return;

    fetch(`${API_URL}/users/${userId}/profile-picture`, {
        method: 'DELETE'
    })
        .then(r => r.json())
        .then(data => {
            if (data.message) {
                alert('Profile picture deleted');
                document.getElementById('userDetailProfilePic').style.display = 'none';
                document.getElementById('noProfilePic').style.display = 'block';
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
            }
        })
        .catch(err => alert('Delete failed: ' + err));
}

function loadUserDetails(userId) {
    fetch(`${API_URL}/users/${userId}`)
        .then(r => r.json())
        .then(data => {
            document.getElementById('detailId').textContent = data.user.id;
            document.getElementById('detailUsername').textContent = data.user.username;
            document.getElementById('detailEmail').textContent = data.user.email;
            document.getElementById('detailStatus').textContent = data.user.status;
            document.getElementById('detailCreated').textContent = formatDateTime(data.user.created_at);
            document.getElementById('detailUpdated').textContent = formatDateTime(data.user.updated_at);

            const a = data.user.address;

            if (a) {
                const left = [a.street, a.house_number].filter(v => v && v.trim()).join(' ');
                const right = [a.city, a.postal_code].filter(v => v && v.trim()).join(' ');

                const full = [left, right].filter(Boolean).join(left && right ? ', ' : '');
                document.getElementById('detailAddress').textContent = full || 'No address';
            } else {
                document.getElementById('detailAddress').textContent = 'No address';
            }

            const rolesEl = document.getElementById('detailRoles');
            if (data.roles && data.roles.length > 0) {
                rolesEl.innerHTML = data.roles.map(r =>
                    `<div>${r.role_name} (assigned: ${formatDateTime(r.assigned_at)})</div>`
                ).join('');
            } else {
                rolesEl.innerHTML = 'No roles assigned';
            }

            const metaEl = document.getElementById('detailMetadata');
            if (data.metadata && Object.keys(data.metadata).length > 0) {
                metaEl.innerHTML = Object.entries(data.metadata).map(([k, v]) =>
                    `<div><strong>${k}:</strong> ${v}</div>`
                ).join('');
            } else {
                metaEl.innerHTML = 'No metadata';
            }

            const imgEl = document.getElementById('userDetailProfilePic');
            const noPicEl = document.getElementById('noProfilePic');

            fetch(`${API_URL}/users/${userId}/profile-picture`)
                .then(r => {
                    if (r.ok) {
                        imgEl.src = `${API_URL}/users/${userId}/profile-picture?t=${Date.now()}`;
                        imgEl.style.display = 'block';
                        noPicEl.style.display = 'none';
                    } else {
                        imgEl.style.display = 'none';
                        noPicEl.style.display = 'block';
                    }
                })
                .catch(() => {
                    imgEl.style.display = 'none';
                    noPicEl.style.display = 'block';
                });
        })
        .catch(err => {
            console.error('Error loading user details:', err);
            showMessage('userDetailsMsg', 'error', 'Failed to load user details');
        });
}

document.addEventListener('DOMContentLoaded', function () {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', login);
    }

    if (window.location.pathname.includes('index.html')) {
        const token = localStorage.getItem('token');
        if (token) {
            const roles = JSON.parse(localStorage.getItem('roles') || '[]');
            console.log('User roles:', roles);

            if (!roles.includes('Administrator') && !roles.includes('Manager')) {
                document.querySelectorAll('.section').forEach(section => {
                    if (!section.contains(document.getElementById('usersTable'))) {
                        section.style.display = 'none';
                    }
                });
            } else if (roles.includes('Manager') && !roles.includes('Administrator')) {
                document.getElementById('auditSection').style.display = 'none';
                document.getElementById('assignRoleSection').style.display = 'none';
            }

            const username = localStorage.getItem('username') || 'Unknown';
            const currentUserEl = document.getElementById('currentUser');
            if (currentUserEl) {
                currentUserEl.textContent = `User: ${username}`;
            }

            loadRoles();
            loadUsersWithRoles();
        } else {
            window.location.href = 'login.html';
        }
    }
});
