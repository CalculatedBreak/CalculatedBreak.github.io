// Game Preloader — click PLAY and the game starts instantly (no ads, no external links)
// Include in your game page: <script src="game-preloader.js"></script>

(function () {
    'use strict';

    let gameStarted = false;

    // Create the PLAY button overlay
    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'game-play-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 999999;
        `;

        const button = document.createElement('button');
        button.innerHTML = '&#9654; PLAY GAME';
        button.style.cssText = `
            background: #19C614;
            color: white;
            font-size: 48px;
            font-weight: bold;
            padding: 30px 60px;
            border: none;
            border-radius: 15px;
            cursor: pointer;
            box-shadow: 0 8px 0 #0F9210, 0 10px 20px rgba(0,0,0,0.3);
            transition: all 0.1s;
            touch-action: manipulation;
            -webkit-tap-highlight-color: rgba(0,0,0,0);
        `;

        button.onmouseover = () => {
            button.style.transform = 'translateY(-5px)';
            button.style.boxShadow = '0 13px 0 #0F9210, 0 15px 25px rgba(0,0,0,0.4)';
        };

        button.onmouseout = () => {
            button.style.transform = 'translateY(0)';
            button.style.boxShadow = '0 8px 0 #0F9210, 0 10px 20px rgba(0,0,0,0.3)';
        };

        button.onmousedown = () => {
            button.style.transform = 'translateY(4px)';
            button.style.boxShadow = '0 4px 0 #0F9210, 0 6px 15px rgba(0,0,0,0.3)';
        };

        const handlePlay = (e) => {
            e.preventDefault();
            e.stopPropagation();
            startGame();
        };

        button.addEventListener('touchend', handlePlay, { passive: false });
        button.addEventListener('click', handlePlay);

        overlay.appendChild(button);
        document.body.appendChild(overlay);
    }

    // Remove the overlay and nudge the game so it picks up focus/size
    function removeOverlay() {
        const overlay = document.getElementById('game-play-overlay');
        if (overlay) overlay.remove();

        let count = 0;
        const nudge = setInterval(() => {
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new Event('focus'));
            const canvas = document.querySelector('canvas');
            if (canvas) canvas.click();
            count++;
            if (count >= 10) clearInterval(nudge);
        }, 100);
    }

    // Resume any audio that was waiting for a user click
    function resumeAudio() {
        document.querySelectorAll('audio, video').forEach((m) => {
            m.muted = false;
            m.volume = 1;
        });
    }

    // Start the game exactly once
    function startGame() {
        if (gameStarted) return;
        gameStarted = true;
        removeOverlay();
        resumeAudio();
    }

    window.addEventListener('load', createOverlay);
})();