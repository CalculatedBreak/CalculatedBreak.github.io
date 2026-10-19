/**
 * EduSphere Academy — Dashboard Module System
 *
 * This file:
 *  1. Reads game metadata from GAME_MODULES (populated from the games catalogue)
 *  2. Renders module cards on dashboard.html
 *  3. Launches games in a new tab via about:blank + fullscreen iframe
 */

/* =============================================================================
   GAME MODULE CONFIGURATION
   ============================================================================= */

const GAME_MODULES = [
  { href: "games/bob-the-robber-2/",        img: "images/bob-the-robber-2.png",                                                     title: "Bob the Robber 2",     cat: "action"     },
  { href: "games/vex7/",                    img: "images/vex7.jpeg",                                                                title: "Vex 7",                    cat: "action"     },
  { href: "games/vex6/",                    img: "images/vex6.jpeg",                                                                title: "Vex 6",                    cat: "action"     },
  { href: "games/minecraft/",               img: "images/mc.png",                                                                   title: "Minecraft",                cat: "action"     },
  { href: "games/moto-x3m/",                img: "images/moto-x3m.jpg",                                                             title: "Moto X3M",                 cat: "racing"     },
  { href: "games/retro-bowl/",              img: "images/retro-bowl.jpg",                                                           title: "Retro Bowl",               cat: "sports"     },
  { href: "games/drive-mad/",               img: "images/drive-mad.jpg",                                                            title: "Drive Mad",                cat: "racing"     },
  { href: "games/slope/",                   img: "images/slope.jpg",                                                                title: "Slope",                    cat: "action"     },
  { href: "games/motox3m2/",                img: "images/motox3m2.jpg",                                                             title: "Moto X3M 2",               cat: "racing"     },
  { href: "games/Idle Breakout/",           img: "games/Idle Breakout/image.png",                                                   title: "Idle Breakout",          cat: "idle"        },
  { href: "games/getaway-shootout/",        img: "games/getaway-shootout/images.jpg",                                           title: "Getaway Shootout",     cat: "multiplayer"},
  { href: "games/bitlife/",                 img: "games/bitlife/logo.png",                                                          title: "BitLife",                  cat: "idle"        },
  { href: "games/subway-surfers-ny/",       img: "games/subway-surfers-ny/NewYorkIcon.png",                                         title: "Subway Surfers NY",    cat: "action"     },
  { href: "games/just-fall/",               img: "games/just-fall/unnamed.png",                                                     title: "Just Fall",                cat: "multiplayer"},
  { href: "games/2048/",                    img: "games/2048/2048.png",                                                             title: "2048",                     cat: "puzzle"     },
  { href: "games/vex3/",                    img: "images/vex3.jpg",                                                                 title: "Vex 3",                    cat: "action"     },
  { href: "games/vex4/",                    img: "images/vex4.jpg",                                                                 title: "Vex 4",                    cat: "action"     },
  { href: "games/vex5/",                    img: "images/vex5.jpg",                                                                 title: "Vex 5",                    cat: "action"     },
  { href: "games/cookie-clicker/",          img: "games/cookie-clicker/cookie1.jpeg",                                               title: "Cookie Clicker",           cat: "idle"        },
  { href: "games/poly-track/",              img: "games/poly-track/poly-track.jpg",                                                 title: "Poly Track",               cat: "racing"     },
  { href: "games/bloxorz/",                 img: "games/bloxorz/blox.jpg",                                                          title: "Bloxorz",                  cat: "puzzle"     },
  { href: "games/ss-tokyo/",                img: "games/ss-tokyo/ss-tokyo.webp",                                                    title: "Subway Surfers Tokyo", cat: "action"     },
  { href: "games/smhook/",                  img: "games/smhook/logo.png",                                                           title: "Stickman Hook",          cat: "action"     },
  { href: "games/r-a/",                     img: "games/r-a/logo.jpeg",                                                             title: "Ragdoll Archers",        cat: "action"     },
  { href: "games/r-s/",                     img: "games/r-s/unnamed.webp",                                                          title: "Race Survival",          cat: "racing"     },
  { href: "games/a-u/",                     img: "games/a-u/a-u.png",                                                               title: "Among Us",                 cat: "multiplayer"},
  { href: "games/ovo/",                     img: "games/ovo/ovo.png",                                                               title: "OvO",                      cat: "action"     },
  { href: "games/sls/",                     img: "games/sls/sls.webp",                                                              title: "Super Liquid Soccer",    cat: "sports"     },
  { href: "games/a-m/",                     img: "games/a-m/unnamed.webp",                                                          title: "Arrow Master",             cat: "action"     },
  { href: "games/gag/",                     img: "games/gag/gag.webp",                                                              title: "Grow a Garden",          cat: "idle"        },
  { href: "games/bike-obby/",               img: "games/bike-obby/bike-obby.webp",                                                  title: "Bike Obby",                cat: "racing"     },
  { href: "games/i-a/",                     img: "games/99-n/i-a.jpg",                                                              title: "Idle Ants",                cat: "idle"        },
  { href: "games/d-d/",                     img: "games/d-d/d-d.png",                                                               title: "Deadly Descent",           cat: "action"     },
  { href: "games/m-m/",                     img: "games/m-m/m-m.webp",                                                              title: "Monkey Mart",              cat: "idle"        },
  { href: "games/g-s/",                     img: "games/g-s/g-s.webp",                                                              title: "Gun Spin",                 cat: "action"     },
  { href: "games/s-r/",                     img: "games/s-r/s-r.png",                                                               title: "Snow Rider",               cat: "racing"     },
  { href: "games/basket-random/",           img: "games/basket-random/basket.png",                                                  title: "Basket Random",            cat: "sports"     },
  { href: "games/slow-roads/",              img: "games/slow-roads/slow-roads.webp",                                                title: "Slow Roads",               cat: "racing"     },
  { href: "games/r-h/",                     img: "games/r-h/r-h.png",                                                               title: "Ragdoll Hit",              cat: "action"     },
  { href: "games/spiral-roll/",             img: "games/spiral-roll/spiral-roll.png",                                               title: "Spiral Roll",              cat: "puzzle"     },
  { href: "games/rooftop-snipers/",         img: "games/rooftop-snipers/rooftop-snipers.webp",                                      title: "Rooftop Snipers",        cat: "multiplayer"},
  { href: "games/drift-boss/",              img: "games/drift-boss/drift-boss.png",                                                 title: "Drift Boss",               cat: "racing"     },
  { href: "games/dune/",                    img: "games/dune/dune.jpg",                                                             title: "Dune",                     cat: "action"     },
  { href: "games/e-car/",                   img: "games/e-c.jpg",                                                                   title: "Escape Car",               cat: "racing"     },
  { href: "games/t-a-b/",                   img: "games/t-a-b/t-a-b.jpeg",                                                          title: "Thorns And Balloons",    cat: "puzzle"     },
  { href: "games/basketball-stars/",        img: "games/basketball-stars/basketball-stars.webp",                                    title: "Basketball Stars",       cat: "sports"     },
  { href: "games/1v1lol/",                  img: "games/1v1lol/1v1lol.webp",                                                        title: "1v1.lol",                  cat: "multiplayer"},
  { href: "games/hard-game/",               img: "games/hard-game/hard-game.webp",                                                  title: "World's Hardest Game",   cat: "puzzle"     },
  { href: "games/t-r-2/",                   img: "games/t-r-2/t-r-2.webp",                                                          title: "Temple Run 2",             cat: "action"     },
  { href: "games/eggy-car/",                img: "games/eggy-car/eggy-car.webp",                                                    title: "Eggy Car",                 cat: "racing"     },
  { href: "games/e-scooter/",               img: "games/e-scooter/e-scooter.jpg",                                                   title: "E-Scooter",                cat: "racing"     },
  { href: "games/red-ball/",                img: "games/red-ball/red-ball.jpg",                                                     title: "Red Ball 4",               cat: "action"     },
  { href: "games/p-c/",                     img: "games/p-c/p-c.png",                                                               title: "Pocket Champions",         cat: "multiplayer"},
  { href: "games/spacebar-clicker/",        img: "games/spacebar-clicker/spacebar-clicker.png",                                     title: "Spacebar Clicker",       cat: "idle"        },
  { href: "games/bridge-race/",             img: "games/bridge-race/bridge-race.webp",                                              title: "Bridge Race",              cat: "racing"     },
  { href: "games/blumgi-slime/",            img: "games/blumgi-slime/blumgi-slime.png",                                             title: "Blumgi Slime",             cat: "action"     },
  { href: "games/paper.io-2/",              img: "games/paper.io-2/paper.io-2.png",                                                 title: "Paper.io 2",               cat: "io"          },
  { href: "games/golf-orbit/",              img: "games/golf-orbit/golf-orbit.webp",                                                title: "Golf Orbit",               cat: "sports"     },
  { href: "games/ultrakill/",               img: "games/ultrakill/ultrakill.png",                                                   title: "UltraKill",                cat: "action"     },
  { href: "games/clash/",                   img: "games/clash/clash.png",                                                           title: "Clash Royale",             cat: "multiplayer"},
  { href: "games/little/",                  img: "games/little/little.png",                                                         title: "Little Alchemy 2",       cat: "puzzle"     },
  { href: "games/math-duck/",               img: "games/math-duck/math-duck.webp",                                                  title: "Math Duck",                cat: "puzzle"     },
  { href: "games/gold-digger/",             img: "games/gold-digger/gold-digger.webp",                                              title: "Gold Digger FRVR",       cat: "idle"        },
  { href: "games/blumgi-rocket/",           img: "games/blumgi-rocket/blumgi-rocket.webp",                                          title: "Blumgi Rocket",            cat: "action"     },
  { href: "games/fruit-ninja/",             img: "games/fruit-ninja/fruit-ninja.png",                                               title: "Fruit Ninja",              cat: "action"     },
  { href: "games/drift-hunters/",           img: "games/drift-hunters/drift-hunters.png",                                           title: "Drift Hunters",            cat: "racing"     },
  { href: "games/soccer-random/",           img: "games/soccer-random/soccer-random.webp",                                          title: "Soccer Random",            cat: "sports"     },
  { href: "games/volley-random/",           img: "games/volley-random/volley-random.webp",                                          title: "Volley Random",            cat: "sports"     },
  { href: "games/boxing-random/",           img: "games/boxing-random/boxing-random.webp",                                          title: "Boxing Random",            cat: "sports"     },
  { href: "games/yoho/",                    img: "games/yoho/yoho.png",                                                             title: "Yohoho.io",                cat: "io"          },
  { href: "games/dl3/",                     img: "games/dl3/dl3.jpg",                                                               title: "Duck Life 3",              cat: "idle"        },
  { href: "games/archery/",                 img: "games/archery/archery.png",                                                       title: "Archery World Tour",       cat: "sports"     },
  { href: "games/happy-glass/",             img: "games/happy-glass/happy-glass.png",                                               title: "Happy Glass",              cat: "puzzle"     },
  { href: "games/unicycle-hero/",           img: "games/unicycle-hero/unicycle-hero.png",                                           title: "Unicycle Hero",            cat: "action"     },
  { href: "games/stick-merge/",             img: "games/stick-merge/stick-merge.webp",                                              title: "Stick Merge",              cat: "action"     },
  { href: "games/swingo/",                  img: "games/b-s/b-s.png",                                                               title: "Blumgi Swingo",            cat: "action"     },
  { href: "games/msc2/",                    img: "games/msc2/msc2.png",                                                             title: "Madalin Stunt Cars 2",     cat: "racing"     },
  { href: "games/ping1/",                   img: "games/ping/ping.avif",                                                            title: "Ping Pong Go",             cat: "sports"     },
  { href: "games/2min/",                    img: "games/2min/418572a6bbddb5359501b93153290fba.png",                                  title: "2 Minute Football",      cat: "sports"     },
  { href: "games/pko/",                     img: "games/pko/pko.png",                                                               title: "Penalty Kick Online",      cat: "sports"     },
  { href: "games/mining/",                  img: "games/mining/mining.webp",                                                        title: "Idle Mining Empire",       cat: "idle"        },
  { href: "games/idle-r/",                  img: "games/idle-r/idle-r.webp",                                                        title: "Idle Restaurants",         cat: "idle"        },
  { href: "games/crazy-cars/",              img: "games/crazy-cars/crazy-cars.webp",                                                title: "Crazy Cars",               cat: "racing"     },
  { href: "games/burn/",                    img: "games/burn/burn.jpg",                                                             title: "Burnin' Rubber",           cat: "racing"     },
  { href: "games/sb/",                      img: "games/sb/sb.jpg",                                                                 title: "Sand Boxels",              cat: "puzzle"     },
  { href: "games/holeio/",                  img: "games/holeio/holeio.webp",                                                        title: "Hole.io",                  cat: "io"          },
  { href: "games/kart-bros/",               img: "https://store-images.s-microsoft.com/image/apps.50957.14077711198622072.87de44b8-a3b1-4457-9a12-07ae7d1d2d1d.b7f82a68-5baf-43b2-a0f7-bba2ebf39c8c", title: "Kart Bros", cat: "racing" },
  { href: "games/boxing-bros/",             img: "games/boxing-bros/boxing-bros.avif",                                              title: "Wrestle Bros",             cat: "sports"     },
  { href: "games/g-d",                      img: "images/geometry-dash.png",                                                        title: "Geometry Dash",            cat: "action"     },
  { href: "games/s-k/",             img: "games/s-k/icon.png",                                                       title: "Smash Karts",              cat: "racing"     },
  { href: "games/tiny-fishing",            img: "/games/tiny-fishing/iconTF.png",                                                  title: "Tiny Fishing",             cat: "idle"        },
  { href: "games/BlackJack",               img: "/games/BlackJack/Icon.png",                                                       title: "BlackJack",                cat: "card"        },
  { href: "games/blumgi-bounce",           img: "/games/blumgi-bounce/icon.jpg",                                                   title: "Blumgi Bounce",            cat: "sports"        },
  { href: "games/gladihoppers",           img: "/images/gladihoppers.png",                                                   title: "Gladihoppers",            cat: "sports"        },
  { href: "games/johnny-trigger-sniper",           img: "/images/johnny-trigger-sniper.png",                                                   title: "Johnny Trigger Sniper",            cat: "shooter"        },
  { href: "games/blumgi-racers",           img: "/images/blumgi-racers.jpg",                                                   title: "Blumgi Racer",            cat: "racing"        },
  { href: "games/car-machines",           img: "/images/car-machines.jfif",                                                   title: "Car Machines",            cat: "racing"        },
  { href: "games/battle-blast",           img: "/images/battle-blast.jpg",                                                   title: "Battle Blast",            cat: "shooter"        },
  { href: "games/slice-master",           img: "/images/slice-master.png",                                                   title: "Slice Master",            cat: "action"        },
  { href: "games/marble-run-3d",           img: "/images/marble-run-3d.jpg",                                                   title: "Marble Run 3D",            cat: "racing"        },

].filter(module => module.href.startsWith("games/"));

/* =============================================================================
   CARD RENDERING
   ============================================================================= */

function renderModuleCards() {
  const grid = document.getElementById('module-grid');
  if (!grid) return;

  grid.innerHTML = '';

  if (!GAME_MODULES.length) {
    grid.classList.add('module-grid--empty');
    grid.textContent = 'No interactive modules are configured. Add entries to GAME_MODULES in script.js.';
    return;
  }

  grid.classList.remove('module-grid--empty');

  GAME_MODULES.forEach((module) => {
    const card = document.createElement('article');
    card.className = 'module-card';
    card.setAttribute('role', 'listitem');
    card.dataset.href = module.href;

    card.innerHTML = `
      <div class="module-card-icon" aria-hidden="true" style="height:140px;overflow:hidden;background:#e8f0fa;padding:0;">
        <img src="${escapeHtml(module.img)}" alt="${escapeHtml(module.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentElement.style.background='linear-gradient(135deg,#e8f0fa,#f0f5fb)'">
      </div>
      <div class="module-card-body">
        <span class="module-tag">${escapeHtml(module.cat)}</span>
        <h3>${escapeHtml(module.title)}</h3>
        <button type="button" class="btn btn-primary btn-launch" data-href="${escapeHtml(module.href)}">
          Launch
        </button>
      </div>
    `;

    card.addEventListener('click', (event) => {
      if (event.target.closest('.btn-launch')) return;
      launchSimulation(module.href);
    });

    card.querySelector('.btn-launch').addEventListener('click', (event) => {
      event.stopPropagation();
      launchSimulation(module.href);
    });

    grid.appendChild(card);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* =============================================================================
   LAUNCHER
   ============================================================================= */

function launchSimulation(href) {
  if (!href) {
    console.error('Invalid game path.');
    return;
  }

  window.open(href, '_blank');
}

/* =============================================================================
   INIT
   ============================================================================= */

document.addEventListener('DOMContentLoaded', renderModuleCards);
