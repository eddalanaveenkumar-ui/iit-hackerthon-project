import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * NO DEMO ACCOUNTS ON THE LOGIN PAGE
 * ==================================
 *
 * The login page used to ship four one-click demo accounts and pre-fill the form
 * with a real address and its password. That listed live credentials on a public
 * page, and the shared password opened every one of them.
 *
 * This pins the three things that were visible to a visitor:
 *
 *   1. no list of accounts anywhere on the page;
 *   2. no credentials pre-filled into the form;
 *   3. the demo password does not appear in the source at all.
 */

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, login: vi.fn() }),
}));

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggle: vi.fn() }),
}));

const { default: Login } = await import('../pages/Login');
const loginSource = await import('../pages/Login?raw');

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );

describe('the login page', () => {
  it('offers no demo accounts', () => {
    renderLogin();
    expect(screen.queryByText(/demo account/i)).toBeNull();
    expect(screen.queryByText(/learnmate\.ai/i)).toBeNull();
    expect(screen.queryByText(/use$/i)).toBeNull();
  });

  it('does not pre-fill anyone’s credentials', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i).value).toBe('');
    expect(screen.getByLabelText(/password/i).value).toBe('');
  });

  it('never mentions the old shared password', () => {
    expect(loginSource.default).not.toMatch(/LearnMate123/);
  });

  it('still lets a real account sign in', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /create an account/i })).toBeTruthy();
  });
});
