const BASE = '/api/tasks';

const json = (res) => {
  if (!res.ok) return res.json().then((e) => Promise.reject(e));
  return res.json();
};

export const getTasks = () => fetch(BASE).then(json);

export const getTask = (id) => fetch(`${BASE}/${id}`).then(json);

export const createTask = (data) =>
  fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json);

export const updateTask = (id, data) =>
  fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json);

export const deleteTask = (id) =>
  fetch(`${BASE}/${id}`, { method: 'DELETE' }).then(json);
