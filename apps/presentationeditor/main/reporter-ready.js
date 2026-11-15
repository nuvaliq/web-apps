define(function() {
    'use strict';
    return function repeatPresenterReady(options) {
        var schedule = options.schedule || setTimeout;
        var cancel = options.cancel || clearTimeout;
        var stopped = false;
        var timer;
        function send() {
            if (stopped) return;
            options.send();
            if (!stopped) timer = schedule(send, options.interval);
        }
        timer = schedule(send, options.firstDelay);
        return {stop: function() {
            if (stopped) return;
            stopped = true;
            cancel(timer);
        }};
    };
});
