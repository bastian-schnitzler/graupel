import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

const ThrowingComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test component crash');
  }
  return <div>Component rendered successfully</div>;
};

describe('ErrorBoundary Component', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Component rendered successfully')).toBeTruthy();
  });

  it('renders fallback error card when child component throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallbackTitle="Custom Error Title">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary')).toBeTruthy();
    expect(screen.getByText('Custom Error Title')).toBeTruthy();
    expect(screen.getByText('Test component crash')).toBeTruthy();

    consoleSpy.mockRestore();
  });

  it('calls onReset callback when Try Again button is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onResetMock = vi.fn();

    render(
      <ErrorBoundary onReset={onResetMock}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    const retryBtn = screen.getByRole('button', { name: /Try Again/i });
    fireEvent.click(retryBtn);

    expect(onResetMock).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
