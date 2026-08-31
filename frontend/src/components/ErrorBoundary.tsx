import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ArrowClockwise, Warning } from '@phosphor-icons/react';

/**
 * Keeps one broken screen from taking the whole application with it.
 *
 * This was written after clicking a day in Events turned the entire page
 * white. The cause was small — the RSVP panel read `rsvp.invitations.total`
 * from a response that carries `totalInvited` — but React's response to a
 * throw during render is to unmount the whole tree, so a wrong property name
 * on one panel presented as an application that had simply vanished. There is
 * no way for somebody to report that usefully: there is nothing on screen to
 * describe, and the reflex is to reload and lose the page they were on.
 *
 * A boundary does not make the bug go away. It changes what the bug looks
 * like: the sidebar survives, the person can leave for another screen, and the
 * message names the page that failed. The console still carries the stack, so
 * nothing is hidden from whoever is fixing it.
 *
 * Keyed on the route by its caller, so navigating away clears the error rather
 * than leaving somebody stuck on a broken screen with no way out.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Deliberately still logged. The boundary is for the person using the app;
    // the stack is for the person fixing it, and swallowing it here would trade
    // one silent failure for another.
    console.error('Screen failed to render', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="card mx-auto max-w-lg space-y-3 text-center">
        <p className="flex justify-center text-critical-fg">
          <Warning size={28} weight="fill" aria-hidden />
        </p>
        <h1 className="section-title">This page could not be shown</h1>
        <p className="text-sm text-gray-600">
          Something on it went wrong. Nothing you did caused it and nothing has been lost. You can
          try again, or use the menu to go somewhere else.
        </p>
        <div className="flex justify-center">
          <button className="btn btn-sm" onClick={() => this.setState({ error: null })}>
            <ArrowClockwise size={15} aria-hidden />
            Try again
          </button>
        </div>
      </div>
    );
  }
}
