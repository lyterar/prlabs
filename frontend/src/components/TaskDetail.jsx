import { useState, useEffect } from 'react';
import { getTask } from '../api';

export default function TaskDetail({ id, onClose, onEdit }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getTask(id)
      .then((data) => { setTask(data); setLoading(false); })
      .catch(() => { setError('Failed to load task'); setLoading(false); });
  }, [id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Task Detail</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        {loading && <p className="center">Loading...</p>}
        {error && <p className="error">{error}</p>}
        {task && (
          <div className="detail-body">
            <div className="detail-row">
              <span className="detail-label">ID</span>
              <span>{task.id}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Title</span>
              <span>{task.title}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Description</span>
              <span>{task.description || '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className={`badge ${task.completed ? 'badge-done' : 'badge-todo'}`}>
                {task.completed ? 'Done' : 'To Do'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Created</span>
              <span>{new Date(task.created_at).toLocaleString()}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Updated</span>
              <span>{new Date(task.updated_at).toLocaleString()}</span>
            </div>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
          {task && (
            <button className="btn btn-warning" onClick={() => onEdit(task)}>
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
