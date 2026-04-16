import { useState, useEffect } from 'react'
import axios from 'axios'

export default function Users() {
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/users')
      .then((r) => setUsers(r.data))
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="error">Error: {error}</div>
  if (!users.length) return <div className="loading">Loading users…</div>

  return (
    <div>
      <div className="page-title">Users</div>
      <div className="table-card">
        <div className="table-header">
          <span className="table-title">All Users</span>
          <div className="table-toolbar">
            <button className="tool-btn">Add User</button>
            <button className="tool-btn">Export</button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td><span className={`badge badge-${u.role}`}><span className="dot" /> {u.role}</span></td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
