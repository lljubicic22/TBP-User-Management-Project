CREATE OR REPLACE VIEW v_users_with_roles AS
SELECT
    u.id,
    u.username,
    u.email,
    u.status,
    u.created_at,
    COALESCE(
        json_agg(
            json_build_object(
                'role_id', r.role_id,
                'role_name', r.role_name,
                'assigned_at', ur.assigned_at,
                'expires_at', ur.expires_at
            )
        ) FILTER (WHERE r.role_id IS NOT NULL),
        '[]'
    ) as roles
FROM users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.role_id
GROUP BY u.id, u.username, u.email, u.status, u.created_at;

CREATE OR REPLACE VIEW v_database_metadata AS
SELECT
    c.relname AS table_name,
    a.attname AS column_name,
    t.typname AS data_type,
    a.attnotnull AS not_null,
    a.attnum AS column_position,
    pg_get_expr(d.adbin, d.adrelid) AS default_value
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_attribute a ON c.oid = a.attrelid
JOIN pg_catalog.pg_type t ON a.atttypid = t.oid
LEFT JOIN pg_catalog.pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
WHERE c.relname IN ('users', 'roles', 'permissions', 'user_roles', 'role_permissions')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

CREATE OR REPLACE VIEW v_role_statistics AS
SELECT
  r.role_name,
  COUNT(ur.user_id) as user_count,
  COUNT(ur.user_id) FILTER (WHERE u.is_active = TRUE) as active_user_count
FROM roles r
LEFT JOIN user_roles ur ON r.role_id = ur.role_id
LEFT JOIN users u ON ur.user_id = u.id
GROUP BY r.role_name
ORDER BY r.role_name;

CREATE OR REPLACE VIEW v_recent_audit_log AS
SELECT
    al.log_id,
    al.table_name,
    al.operation,
    al.user_id,
    u.username,
    al.changed_at,
    al.old_data,
    al.new_data
FROM audit_log al
LEFT JOIN users u ON al.user_id = u.id
ORDER BY al.changed_at DESC
LIMIT 100;
