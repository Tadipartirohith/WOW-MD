import axios from 'axios';
import { useAuth } from '../store/auth';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

// Attach the access token to every request.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear auth so the router redirects to login.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) useAuth.getState().logout();
    return Promise.reject(error);
  },
);
