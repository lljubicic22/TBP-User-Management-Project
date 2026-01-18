CREATE TRIGGER update_base_user_timestamp
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER audit_user_changes
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION log_user_changes();

CREATE TRIGGER trg_deactivate_user
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION deactivate_user_if_deleted();