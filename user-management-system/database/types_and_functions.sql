CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_user_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, operation, user_id, old_data, new_data)
        VALUES (TG_TABLE_NAME, TG_OP, OLD.id, row_to_json(OLD), NULL);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, user_id, old_data, new_data)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, row_to_json(OLD), row_to_json(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, user_id, old_data, new_data)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, NULL, row_to_json(NEW));
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id INTEGER)
RETURNS TABLE(
  permission_name VARCHAR,
  resource_type   VARCHAR,
  description     TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    p.permission_name,
    p.resource_type,
    p.description
  FROM user_roles ur
  JOIN role_permissions rp ON ur.role_id = rp.role_id
  JOIN permissions p ON rp.permission_id = p.permission_id
  WHERE ur.user_id = p_user_id
    AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE PROCEDURE assign_role_to_user(
    p_user_id INTEGER,
    p_role_name VARCHAR,
    p_assigned_by INTEGER DEFAULT NULL,
    p_expires_at TIMESTAMP DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_role_id INTEGER;
BEGIN
    SELECT role_id INTO v_role_id
    FROM roles
    WHERE role_name = p_role_name;

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Role % does not exist', p_role_name;
    END IF;

    INSERT INTO user_roles (user_id, role_id, assigned_by, expires_at)
    VALUES (p_user_id, v_role_id, p_assigned_by, p_expires_at)
    ON CONFLICT (user_id, role_id) DO NOTHING;

    RAISE NOTICE 'Role % assigned to user %', p_role_name, p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_metadata_json(p_user_id INTEGER)
RETURNS JSONB AS $$
BEGIN
    RETURN (
        SELECT jsonb_object_agg(meta_key, meta_value)
        FROM user_custom_metadata
        WHERE user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION deactivate_user_if_deleted()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'DELETED' THEN
        NEW.is_active := FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_user_profile_picture_from_bytes(
  p_user_id INTEGER,
  p_image_data BYTEA,
  p_image_type VARCHAR
)
RETURNS VOID AS $$
DECLARE
  v_old_oid OID;
  v_new_oid OID;
  v_fd INTEGER;
BEGIN
  SELECT profile_picture INTO v_old_oid
  FROM users
  WHERE id = p_user_id;

  v_new_oid := lo_create(0);

  v_fd := lo_open(v_new_oid, 131072);

  PERFORM lowrite(v_fd, p_image_data);

  PERFORM lo_close(v_fd);

  UPDATE users
  SET profile_picture = v_new_oid,
      profile_picture_type = p_image_type,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_user_id;

  IF v_old_oid IS NOT NULL THEN
    PERFORM lo_unlink(v_old_oid);
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_profile_picture_bytes(
  p_user_id INTEGER
)
RETURNS TABLE(
  image_data BYTEA,
  image_type VARCHAR
) AS $$
DECLARE
  v_oid OID;
  v_type VARCHAR;
  v_fd INTEGER;
  v_data BYTEA;
BEGIN
  SELECT profile_picture, profile_picture_type
  INTO v_oid, v_type
  FROM users
  WHERE id = p_user_id;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_fd := lo_open(v_oid, 262144);

  v_data := loread(v_fd, 10485760);

  PERFORM lo_close(v_fd);

  RETURN QUERY SELECT v_data, v_type;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_user_profile_picture(
  p_user_id INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_oid OID;
BEGIN
  SELECT profile_picture INTO v_oid
  FROM users
  WHERE id = p_user_id;

  IF v_oid IS NULL THEN
    RETURN FALSE;
  END IF;

  PERFORM lo_unlink(v_oid);

  UPDATE users
  SET profile_picture = NULL,
      profile_picture_type = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
