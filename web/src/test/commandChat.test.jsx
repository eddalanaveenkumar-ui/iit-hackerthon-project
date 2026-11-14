import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * The chat page, mounted for real.
 *
 * The component tests cover the pieces; this covers the wiring — that the page
 * renders, that a local command is answered without a network round trip, and
 * that plain text routes to the lesson studio. `api` is mocked so nothing here
 * depends on a running server.
 */

const apiMock = vi.fn();
vi.mock('../lib/api', () => ({ api: (...args) => apiMock(...args) }));
vi.mock('../components/ResumeCard', () => ({ default: () => null }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import CommandChat from '../pages/CommandChat';

function renderPage() {
  return render(
    <MemoryRouter>
      <CommandChat />
    </MemoryRouter>,
  );
}

describe('the chat page', () => {
  beforeEach(() => {
    apiMock.mockReset();
    navigateMock.mockReset();
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  it('opens on a prompt, not an empty screen', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /what do you want to learn/i })).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('answers /help from the client, with no request', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Message'), '/help{Enter}');
    await waitFor(() => expect(screen.getByText(/Commands/)).toBeTruthy());
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('navigates on a command instead of sending a message', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Message'), '/progress{Enter}');
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/app/progress'));
  });

  it('sends plain language to the lesson studio', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Message'), 'teach me recursion{Enter}');
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(`/app/lesson?prompt=${encodeURIComponent('teach me recursion')}`),
    );
  });

  it('shows the learner their own message immediately', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Message'), '/help{Enter}');
    expect(screen.getByText('/help')).toBeTruthy();
  });

  it('starts the /start flow by loading classrooms', async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ classrooms: [] });
    renderPage();
    await user.type(screen.getByLabelText('Message'), '/start{Enter}');
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/tutor/classrooms'));
    await waitFor(() => expect(screen.getByText(/not in a classroom yet/i)).toBeTruthy());
  });
});
