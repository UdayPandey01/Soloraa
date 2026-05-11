export type StreamHandlers<T> = {
    onEvent: (event: T) => void;
    onOpen?: () => void;
    onError?: (error: Event) => void;
    onClose?: () => void;
};

export function openEventStream<T>(url: string, handlers: StreamHandlers<T>) {
    const source = new EventSource(url);
    let closed = false;

    source.onopen = () => {
        handlers.onOpen?.();
    };

    source.onmessage = (event) => {
        if (!event.data) {
            return;
        }
        try {
            const parsed = JSON.parse(event.data) as T;
            handlers.onEvent(parsed);
        } catch {
            // Ignore parse errors for keepalive or malformed frames.
        }
    };

    source.onerror = (error) => {
        if (closed) return;
        handlers.onError?.(error);
    };

    return () => {
        closed = true;
        source.close();
        handlers.onClose?.();
    };
}
