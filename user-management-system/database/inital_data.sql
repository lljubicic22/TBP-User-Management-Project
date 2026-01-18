INSERT INTO roles (role_name, description, is_system_role) VALUES
('Administrator', 'Full access: create user, update user, delete user, view users, view permissions, assign roles, audit log', TRUE),
('Manager', 'View users, view permissions', TRUE),
('Regular User', 'View users', TRUE);

INSERT INTO permissions (permission_name, resource_type, permission_level, description) VALUES
('create-user', 'users', 'WRITE', 'Create user'),
('update-user', 'users', 'WRITE', 'Update user'),
('delete-user', 'users', 'DELETE', 'Delete user'),
('view-users', 'users', 'READ', 'View users'),
('assign-roles', 'roles', 'WRITE', 'Role assignment'),
('view-audit', 'audit', 'READ', 'Audit log'),
('view-permissions', 'permissions', 'READ', 'View permissions');

INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, permission_id FROM permissions;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, p.permission_id FROM permissions p
WHERE p.permission_name IN ('view-users', 'view-permissions', 'create-user', 'update-user', 'delete-user');

INSERT INTO role_permissions (role_id, permission_id)
SELECT 3, p.permission_id FROM permissions p
WHERE p.permission_name IN ('view-users');

INSERT INTO users (username, email, password_hash, status, is_active, address) VALUES
('admin', 'admin@company.hr',
 '$2b$12$ImnAaLBrmd7ltc4nbrACYep2i3LdKbDvYK6VDCZM.ZBd2VgTAQUha',
 'ACTIVE', TRUE,
 ROW('Pavlinska', '2', 'Varaždin', '42000', 'Hrvatska')::address_type),

('manager', 'manager@company.hr',
 '$2b$12$ImnAaLBrmd7ltc4nbrACYep2i3LdKbDvYK6VDCZM.ZBd2VgTAQUha',
 'ACTIVE', TRUE,
 ROW('Trg Slobode', '10', 'Varaždin', '42000', 'Hrvatska')::address_type),

('user1', 'user1@company.hr',
 '$2b$12$ImnAaLBrmd7ltc4nbrACYep2i3LdKbDvYK6VDCZM.ZBd2VgTAQUha',
 'ACTIVE', TRUE,
 ROW('Hallerova aleja', '5', 'Varaždin', '42000', 'Hrvatska')::address_type);

INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES
(1, 1, 1),  
(2, 2, 1),  
(3, 3, 1); 

INSERT INTO user_custom_metadata (user_id, meta_key, meta_value) VALUES
(3, 'department', 'IT'),
(3, 'position', 'Junior Developer'),
(3, 'employee_id', 'EMP001');

