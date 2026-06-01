"use strict";

function createDebouncedDisposable(callback, delayMs) {
    let timer = null;
    let lastArgs = [];

    const clear = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const run = (...args) => {
        lastArgs = args;
        clear();
        timer = setTimeout(() => {
            timer = null;
            callback(...lastArgs);
        }, delayMs);
    };

    return {
        run,
        flush() {
            if (!timer) {
                return;
            }
            clear();
            callback(...lastArgs);
        },
        dispose() {
            clear();
        }
    };
}

module.exports = {
    createDebouncedDisposable
};
