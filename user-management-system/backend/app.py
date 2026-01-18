import os
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, request, jsonify
from flask_cors import CORS
import bcrypt
from flask import send_file
from io import BytesIO
import jwt
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")

app = Flask(__name__)
CORS(app)

def get_db_connection():
    try:
        conn = psycopg2.connect(
            os.environ.get("DATABASE_URL"),
            cursor_factory=RealDictCursor
        )
        return conn
    except psycopg2.Error as e:
        print(f"Database connection error: {e}")
        return None

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database error'}), 500
    
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT u.id, u.password_hash
        FROM users u 
        WHERE u.username = %s AND u.is_active = TRUE 
    """, (username,))
    user = cursor.fetchone()

    if user and bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8')):
        userid = user['id']
        cursor.execute("""
            SELECT r.role_name 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.role_id 
            WHERE ur.user_id = %s
        """, (userid,))
        roles_rows = cursor.fetchall()
        roles = [row['role_name'] for row in roles_rows]
        
        token = jwt.encode({'userid': userid, 'roles': roles}, SECRET_KEY, algorithm='HS256')
        cursor.close()
        conn.close()
        return jsonify({'token': token, 'userid': userid, 'roles': roles, 'username': username}), 200
    
    cursor.close()
    conn.close()
    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/users', methods=['GET'])
def get_users():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, email, status, address, created_at, updated_at
        FROM users
        WHERE is_active = TRUE
        ORDER BY id
    """)
    users = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify(users), 200

@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, username, email, status, to_json(address) AS address, created_at, updated_at
        FROM users
        WHERE id = %s
    """, (user_id,))
    user = cursor.fetchone()

    if not user:
        cursor.close()
        conn.close()
        return jsonify({'error': 'User not found'}), 404

    cursor.execute("""
        SELECT r.role_id, r.role_name, ur.assigned_at, ur.expires_at
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id = %s
        ORDER BY r.role_name
    """, (user_id,))
    roles = cursor.fetchall()

    cursor.execute("SELECT get_user_metadata_json(%s) AS metadata", (user_id,))
    md_row = cursor.fetchone()
    metadata = md_row['metadata'] if md_row and md_row['metadata'] else {}

    cursor.close()
    conn.close()

    return jsonify({
        'user': user,
        'roles': roles,
        'metadata': metadata
    }), 200

@app.route('/api/users', methods=['POST'])
def create_user():
    data = request.get_json()
    
    required = ['username', 'email', 'password']
    if not data or not all(k in data for k in required):
        return jsonify({'error': 'Missing required fields: username, email, password'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()

    password_hash = bcrypt.hashpw(
        data['password'].encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')

    try:
        street = data.get('street', '')
        house_number = data.get('house_number', '')
        city = data.get('city', '')
        postal_code = data.get('postal_code', '')
        country = data.get('country', '') 
        
        address_str = f"({street}, {house_number}, {city}, {postal_code}, {country})"

        cursor.execute("""
            INSERT INTO users (username, email, password_hash, address)
            VALUES (%s, %s, %s, %s::address_type)
            RETURNING id, username, email, created_at
        """, (
            data['username'],
            data['email'], 
            password_hash,
            address_str
        ))

        new_user = cursor.fetchone()
        user_id = new_user['id']

        roles = data.get('roles', [])
        if not roles:
            cursor.execute("""
                SELECT role_id FROM roles WHERE role_name = 'Regular User'
            """)
            default_role = cursor.fetchone()
            if default_role:
                roles = [default_role['role_id']] 

        for role_id in roles:
            cursor.execute("""
                INSERT INTO user_roles (user_id, role_id, assigned_by)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, role_id) DO NOTHING
            """, (user_id, role_id, user_id))

        conn.commit()

        return jsonify({
            'message': 'User created successfully',
            'user': {
                'id': new_user['id'],
                'username': new_user['username'],
                'email': new_user['email'],
                'created_at': str(new_user['created_at'])
            }
        }), 201

    except psycopg2.IntegrityError:
        conn.rollback()
        return jsonify({'error': 'Username or email already exists'}), 409
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    data = request.get_json()

    if not data:
        return jsonify({'error': 'Missing request body'}), 400

    allowed_fields = ['username', 'email', 'status']
    updates = {k: data[k] for k in allowed_fields if k in data}

    if not updates:
        return jsonify({'error': 'No allowed fields provided'}), 400

    set_parts = []
    values = []
    for k, v in updates.items():
        set_parts.append(f"{k} = %s")
        values.append(v)

    values.append(user_id)
    set_clause = ", ".join(set_parts)

    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()
    try:
        cursor.execute(f"""
            UPDATE users
            SET {set_clause}
            WHERE id = %s
            RETURNING id, username, email, status, is_active, updated_at
        """, tuple(values))

        updated = cursor.fetchone()
        if not updated:
            conn.rollback()
            cursor.close()
            conn.close()
            return jsonify({'error': 'User not found'}), 404

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'message': 'User updated successfully', 'user': updated}), 200

    except Exception as e:
        conn.rollback()
        cursor.close()
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE users
            SET is_active = FALSE, status = 'DELETED'
            WHERE id = %s
            RETURNING id
        """, (user_id,))
        row = cursor.fetchone()

        if not row:
            conn.rollback()
            cursor.close()
            conn.close()
            return jsonify({'error': 'User not found'}), 404

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'message': 'User deactivated (soft delete)'}), 200

    except Exception as e:
        conn.rollback()
        cursor.close()
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/with-roles', methods=['GET'])
def get_users_with_roles():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, username, email, status, created_at, roles
    FROM v_users_with_roles
    ORDER BY id
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify(rows), 200

@app.route('/api/roles', methods=['GET'])
def get_roles():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()
    cursor.execute("SELECT role_id, role_name FROM roles ORDER BY role_name")
    roles = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify(roles), 200

@app.route('/api/users/<int:user_id>/roles', methods=['GET'])
def get_user_roles(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.role_id, r.role_name, r.description, ur.assigned_at, ur.expires_at
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id = %s
        ORDER BY r.role_name
    """, (user_id,))
    roles = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify(roles), 200


@app.route('/api/users/<int:user_id>/roles', methods=['POST'])
def add_user_role(user_id):
    data = request.get_json() or {}

    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()
    try:
        role_id = data.get('role_id')
        role_name = data.get('role_name')
        assigned_by = data.get('assigned_by')

        if role_id is None and not role_name:
            return jsonify({'error': 'Missing role_id or role_name'}), 400

        if role_id is None:
            cursor.execute("SELECT role_id FROM roles WHERE role_name = %s", (role_name,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Role not found'}), 404
            role_id = row['role_id']

        cursor.execute("""
            INSERT INTO user_roles (user_id, role_id, assigned_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, role_id) DO NOTHING
        """, (user_id, role_id, assigned_by))

        conn.commit()
        return jsonify({'message': 'Role assigned successfully'}), 200

    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/audit-log', methods=['GET'])
def get_audit_log():
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    cursor = conn.cursor()
    cursor.execute("""
        SELECT log_id, table_name, operation, user_id, username, changed_at
        FROM v_recent_audit_log
        ORDER BY changed_at DESC
        LIMIT 50
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify(rows), 200

@app.route('/api/users/<int:user_id>/profile-picture', methods=['POST'])
def upload_profile_picture(user_id):
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    image_data = file.read()
    image_type = file.filename.rsplit('.', 1)[1].lower()
    
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT set_user_profile_picture_from_bytes(%s, %s, %s)",
            (user_id, psycopg2.Binary(image_data), image_type)
        )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'message': 'Profile picture uploaded successfully'}), 200
    except Exception as e:
        conn.rollback()
        cursor.close()
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<int:user_id>/profile-picture', methods=['GET'])
def get_profile_picture(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT image_data, image_type FROM get_user_profile_picture_bytes(%s)",
            (user_id,)
        )
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not result or not result['image_data']:
            return jsonify({'error': 'No profile picture found'}), 404
        
        image_data = bytes(result['image_data'])
        image_type = result['image_type']
        
        img_io = BytesIO(image_data)
        img_io.seek(0)
        
        response = send_file(
            img_io,
            mimetype=f'image/{image_type}',
            as_attachment=False
        )
        
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        
        return response
    except Exception as e:
        cursor.close()
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<int:user_id>/profile-picture', methods=['DELETE'])
def delete_profile_picture(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT delete_user_profile_picture(%s)", (user_id,))
        deleted = cursor.fetchone()['delete_user_profile_picture']
        conn.commit()
        cursor.close()
        conn.close()
        
        if deleted:
            return jsonify({'message': 'Profile picture deleted'}), 200
        else:
            return jsonify({'error': 'No profile picture to delete'}), 404
    except Exception as e:
        conn.rollback()
        cursor.close()
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<user_id>/permissions', methods=['GET'])
def get_user_permissions(user_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500
    
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT DISTINCT p.permission_name, p.resource_type, p.description
            FROM permissions p
            JOIN role_permissions rp ON p.permission_id = rp.permission_id
            JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = %s
        """, (user_id,))
        perms = cursor.fetchall()
        return jsonify(perms)
    except Exception as e:
        conn.rollback()
        cursor.close()
        conn.close()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
