
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD75zYxbXDGgkONde7jvCOJXY4r1KBqrts",
  authDomain: "throneadvisor-0.firebaseapp.com",
  projectId: "throneadvisor-0",
  storageBucket: "throneadvisor-0.firebasestorage.app",
  messagingSenderId: "249009206147",
  appId: "1:249009206147:web:5f13581ebba3dfbb697cb6",
  measurementId: "G-80NC66E8P8"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

var myMap = new Mazemap.Map({
  container: "map",
  campuses: 89,
  center: { lng: 12.519825, lat: 55.786341 },
  zoom: 14.7,
  zLevel: 1,
  scrollZoom: true,
});

myMap.on("load", function () {
  myMap.highlighter = new Mazemap.Highlighter(myMap, {
    showOutline: true,
    showFill: true,
    outlineColor: Mazemap.Util.Colors.MazeColors.MazeBlue,
    fillColor: Mazemap.Util.Colors.MazeColors.MazeBlue,
  });
  myMap.on("click", onMapClick);
});

window.addEventListener("resize", function () {
  const isMobile = window.innerWidth <= 768;
  const panel = document.getElementById("poidata");
  const mobileModal = document.getElementById("mobile-modal");

  if (isMobile && panel && !panel.classList.contains("hidden")) {
    panel.classList.remove("open");
    panel.classList.add("hidden");
    document.body.classList.remove("panel-open");
  } else if (!isMobile && mobileModal) {
    mobileModal.remove();
  }

  setTimeout(() => {
    try {
      myMap.resize();
    } catch (e) {}
  }, 300);
});

var mazeMarker;

function onMapClick(e) {
  clearPoiMarker();

  var lngLat = e.lngLat;
  var zLevel = myMap.zLevel;

  Mazemap.Data.getPoiAt(lngLat, zLevel)
    .then(async (poi) => {
      const isToilet = (function (p) {
        try {
          if (!p || !p.properties) return false;
          if (p.properties.poiTypeId === 484) return true;
          const types = p.properties.types;
          if (
            Array.isArray(types) &&
            types.some((t) => t && t.poiTypeId === 484)
          )
            return true;
          return false;
        } catch (e) {
          return false;
        }
      })(poi);

      if (isToilet) {
        console.log(poi)
        let titleMatch = (poi.properties.title || "").match(/\d+/);
        let titleNumber = titleMatch ? titleMatch[0] : "";
        const toiletRef = doc(db, "toilets", String(poi.properties.poiId));
        console.log("trying to set")
        try {
            await setDoc(toiletRef, {
                poiId: poi.properties.poiId,
                name: poi.properties.name || "",
                buildingName: poi.properties.buildingName,
                floorName: poi.properties.floorName,
                titleNumber: titleNumber,
            }, { merge: true });
        } catch(e) {
            console.error("Error adding document: ", e);
        }

        printPoiData(poi);
        placePoiMarker(poi);
        showReviewsPanel(poi);
        setTimeout(() => {
          try {
            myMap.resize();
          } catch (e) {}
        }, 320);
      }
    })
    .catch(function () {
      return false;
    });
}

function printPoiData(poi) {
  var poiStr = JSON.stringify(poi, null, 2); 
  var el = document.getElementById("poi-data");
  if (el) {
    el.innerHTML = poiStr;
  }
}

function clearPoiMarker(poi) {
  if (mazeMarker) {
    mazeMarker.remove();
  }
  myMap.highlighter.clear();
}

async function placePoiMarker(poi) {
  var lngLat = Mazemap.Util.getPoiLngLat(poi);

  mazeMarker = new Mazemap.MazeMarker({
    color: "#ff00cc",
    innerCircle: true,
    innerCircleColor: "#FFF",
    size: 34,
    innerCircleScale: 0.5,
    zLevel: poi.properties.zLevel,
  })
    .setLngLat(lngLat)
    .addTo(myMap);

  try {
    const popup = await createToiletPopup(poi.properties.poiId);
    mazeMarker.setPopup(popup);

    const markerElement = mazeMarker.getElement();
    if (markerElement) {
      markerElement.addEventListener("mouseenter", () => {
        mazeMarker.togglePopup();
      });

      markerElement.addEventListener("mouseleave", () => {
        mazeMarker.togglePopup();
      });
    }
  } catch (error) {
    console.error("Error setting up popup:", error);
  }

  if (poi.geometry.type === "Polygon") {
    myMap.highlighter.highlight(poi);
  }
  myMap.flyTo({ center: lngLat, zoom: 19, speed: 0.5 });
}

function showReviewsPanel(poi) {
  const poiId = poi.properties.poiId;
  const buildingName = poi.properties.buildingName || "Unknown";
  const floorName = poi.properties.floorName || "Unknown";
  const titleMatch = (poi.properties.title || "").match(/\d+/);
  const titleNumber = titleMatch ? titleMatch[0] : "";

  document.getElementById(
    "poi-title"
  ).textContent = `Building ${buildingName}, Floor ${floorName} — Reviews`;
  document.getElementById("poi-subtitle").textContent = titleNumber;

  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    showMobileModal(poi);
  } else {
    const panel = document.getElementById("poidata");
    if (panel) {
      panel.classList.remove("hidden");
      panel.classList.add("open");
      panel.style.display = "block";
      panel.setAttribute("aria-hidden", "false");
      document.body.classList.add("panel-open");
    }
    setTimeout(() => {
      try {
        myMap.resize();
      } catch (e) {}
    }, 220);
    loadReviews(poiId);
  }
}

document.addEventListener("click", function (e) {
  if (e.target && e.target.id === "poidata-close") {
    const panel = document.getElementById("poidata");
    if (panel) {
      panel.classList.remove("open");
      setTimeout(() => {
        panel.classList.add("hidden");
        panel.style.display = "none";
      }, 300);
      panel.setAttribute("aria-hidden", "true");
      document.body.classList.remove("panel-open");
    }
    setTimeout(() => {
      try {
        myMap.resize();
      } catch (err) {}
    }, 60);
  }
});

async function loadReviews(poiId) {
    const el = document.getElementById("reviews");
    const list = document.createElement("div");
    list.innerHTML = "";

    const form = document.createElement("div");
    form.innerHTML = `
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <h3 class="text-lg font-semibold mb-4">Add a Review</h3>
      <form id="review-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">Username</label>
          <input name="username" class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Rating</label>
          <div class="rating-row flex gap-2 mt-1" id="rating-row">
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition" data-score="0">😱</button>
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition" data-score="1">💩</button>
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition" data-score="2">💩💩</button>
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition" data-score="3">💩💩💩</button>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Comment</label>
          <textarea name="text" rows="3" class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500"></textarea>
        </div>
        <div>
          <button type="submit" class="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition">Submit review</button>
        </div>
      </form>
    </div>
    <hr class="mb-6" />
  `;
    el.innerHTML = "";
    el.appendChild(form);

    const reviewsContainer = document.createElement("div");

    const q = query(collection(db, "toilets", String(poiId), "reviews"), orderBy("created_at", "desc"));
    onSnapshot(q, (querySnapshot) => {
        reviewsContainer.innerHTML = '';
        if (querySnapshot.empty) {
            reviewsContainer.innerHTML = '<p class="text-gray-600">No reviews yet.</p>';
        } else {
            querySnapshot.forEach((doc) => {
                const r = doc.data();
                const d = document.createElement("div");
                d.className = "bg-white rounded-lg shadow p-4 mb-4";
                d.innerHTML = `
                <div class="flex items-start gap-3">
                  <div class="flex-1">
                    <div class="font-semibold text-gray-900">${escapeHtml(r.username)}</div>
                    <div class="text-sm text-gray-500">${r.score} poops</div>
                    <div class="text-gray-700 mt-2">${escapeHtml(r.text)}</div>
                  </div>
                </div>
              `;
                reviewsContainer.appendChild(d);
            });
        }
    });

    el.appendChild(reviewsContainer);

    const ratingRow = document.getElementById("rating-row");
    let selectedScore = null;
    if (ratingRow) {
        ratingRow.querySelectorAll(".poop-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                ratingRow
                    .querySelectorAll(".poop-btn")
                    .forEach((b) =>
                        b.classList.remove("bg-yellow-200", "border-yellow-400")
                    );
                btn.classList.add("bg-yellow-200", "border-yellow-400");
                selectedScore = Number(btn.getAttribute("data-score"));
            });
        });
    }

    document
        .getElementById("review-form")
        .addEventListener("submit", async function (ev) {
            ev.preventDefault();
            const fd = new FormData(ev.target);
            const payload = {
                username: fd.get("username") || "anonymous",
                score: selectedScore !== null ? selectedScore : 0,
                text: fd.get("text") || "",
                created_at: new Date()
            };
            
            const toiletRef = doc(db, "toilets", String(poiId));
            const reviewRef = doc(collection(toiletRef, "reviews"));

            try {
                await runTransaction(db, async (transaction) => {
                    const toiletDoc = await transaction.get(toiletRef);
                    if (!toiletDoc.exists()) {
                        throw "Document does not exist!";
                    }

                    const newReviewCount = (toiletDoc.data().review_count || 0) + 1;
                    const oldAvgScore = toiletDoc.data().avgScore || 0;
                    const newAvgScore = ((oldAvgScore * (newReviewCount-1)) + payload.score) / newReviewCount;

                    transaction.update(toiletRef, { review_count: newReviewCount, avgScore: newAvgScore });
                    transaction.set(reviewRef, payload);
                });
            } catch (e) {
                console.error("Transaction failed: ", e);
                alert("Failed to submit review");
            }
            
            ev.target.reset();
        });
}

async function createToiletPopup(poiId) {
  try {
    const toiletRef = doc(db, "toilets", String(poiId));
    const toiletSnap = await getDoc(toiletRef);

    if (!toiletSnap.exists()) {
        return new Mazemap.Popup().setHTML(
            '<div style="padding: 8px;">Loading...</div>'
        );
    }
    const toilet = toiletSnap.data();

    const buildingName = toilet.buildingName || "Unknown";
    const floorName = toilet.floorName || "Unknown";
    const titleNumber = toilet.titleNumber || "";
    const avgScore = toilet.avgScore || 0;
    const scoreStars = "💩".repeat(Math.round(avgScore));

    const popupContent = `
      <div style="padding: 12px; min-width: 200px;">
        <div style="font-weight: bold; color: #111; margin-bottom: 4px;">Building ${buildingName}, Floor ${floorName}</div>
        <div style="font-size: 12px; color: #666; margin-bottom: 8px;">${titleNumber}</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 14px; font-weight: 500;">${avgScore.toFixed(
            1
          )}/3</span>
          <span style="font-size: 16px;">${scoreStars}</span>
        </div>
      </div>
    `;

    return new Mazemap.Popup({
      closeButton: false,
      closeOnClick: false,
    }).setHTML(popupContent);
  } catch (error) {
    return new Mazemap.Popup().setHTML(
      '<div style="padding: 8px;">Error loading info</div>'
    );
  }
}

function showMobileModal(poi) {
  const poiId = poi.properties.poiId;
  const buildingName = poi.properties.buildingName || "Unknown";
  const floorName = poi.properties.floorName || "Unknown";
  const titleMatch = (poi.properties.title || "").match(/\d+/);
  const titleNumber = titleMatch ? titleMatch[0] : "";

  const existingModal = document.getElementById("mobile-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement("div");
  modal.id = "mobile-modal";
  modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end";
  modal.innerHTML = `
    <div class="bg-white w-full max-h-[80vh] rounded-t-lg overflow-hidden">
      <div class="p-4 border-b flex justify-between items-center">
        <div>
          <h2 class="text-lg font-semibold">Building ${buildingName}, Floor ${floorName}</h2>
          <div class="text-sm text-gray-500">${titleNumber}</div>
        </div>
        <button id="mobile-modal-close" class="text-gray-500 hover:text-gray-700 text-xl">✕</button>
      </div>
      <div class="overflow-auto max-h-[calc(80vh-80px)]">
        <div id="mobile-reviews" class="p-4"></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  document
    .getElementById("mobile-modal-close")
    .addEventListener("click", () => {
      modal.remove();
    });

  loadMobileReviews(poiId);
}

async function loadMobileReviews(poiId) {
    const el = document.getElementById("mobile-reviews");

    const form = document.createElement("div");
    form.innerHTML = `
    <div class="bg-gray-50 rounded-lg p-4 mb-4">
      <h3 class="text-md font-semibold mb-3">Add a Review</h3>
      <form id="mobile-review-form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700">Username</label>
          <input name="username" class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Rating</label>
          <div class="rating-row flex gap-2 mt-1" id="mobile-rating-row">
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition text-sm" data-score="0">😱</button>
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition text-sm" data-score="1">💩</button>
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition text-sm" data-score="2">💩💩</button>
            <button type="button" class="poop-btn border rounded p-2 hover:bg-gray-100 transition text-sm" data-score="3">💩💩💩</button>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Comment</label>
          <textarea name="text" rows="3" class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500"></textarea>
        </div>
        <div>
          <button type="submit" class="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition w-full">Submit review</button>
        </div>
      </form>
    </div>
  `;
    el.innerHTML = "";
    el.appendChild(form);

    const reviewsContainer = document.createElement("div");

    const q = query(collection(db, "toilets", String(poiId), "reviews"), orderBy("created_at", "desc"));
    onSnapshot(q, (querySnapshot) => {
        reviewsContainer.innerHTML = '';
        if (querySnapshot.empty) {
            reviewsContainer.innerHTML = '<p class="text-gray-600">No reviews yet.</p>';
        } else {
            querySnapshot.forEach((doc) => {
                const r = doc.data();
                const d = document.createElement("div");
                d.className = "bg-white rounded-lg border p-3 mb-3";
                d.innerHTML = `
                <div class="flex items-start gap-3">
                <div class="flex-1">
                    <div class="font-semibold text-gray-900">${escapeHtml(r.username)}</div>
                    <div class="text-sm text-gray-500">${r.score} poops</div>
                    <div class="text-gray-700 mt-2 text-sm">${escapeHtml(r.text)}</div>
                </div>
                </div>
            `;
                reviewsContainer.appendChild(d);
            });
        }
    });
    el.appendChild(reviewsContainer);

    const ratingRow = document.getElementById("mobile-rating-row");
    let selectedScore = null;
    if (ratingRow) {
        ratingRow.querySelectorAll(".poop-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                ratingRow
                    .querySelectorAll(".poop-btn")
                    .forEach((b) =>
                        b.classList.remove("bg-yellow-200", "border-yellow-400")
                    );
                btn.classList.add("bg-yellow-200", "border-yellow-400");
                selectedScore = Number(btn.getAttribute("data-score"));
            });
        });
    }

    document
        .getElementById("mobile-review-form")
        .addEventListener("submit", async function (ev) {
            ev.preventDefault();
            const fd = new FormData(ev.target);
            const payload = {
                username: fd.get("username") || "anonymous",
                score: selectedScore !== null ? selectedScore : 0,
                text: fd.get("text") || "",
                created_at: new Date()
            };

            const toiletRef = doc(db, "toilets", String(poiId));
            const reviewRef = doc(collection(toiletRef, "reviews"));

            try {
                await runTransaction(db, async (transaction) => {
                    const toiletDoc = await transaction.get(toiletRef);
                    if (!toiletDoc.exists()) {
                        throw "Document does not exist!";
                    }

                    const newReviewCount = (toiletDoc.data().review_count || 0) + 1;
                    const oldAvgScore = toiletDoc.data().avgScore || 0;
                    const newAvgScore = ((oldAvgScore * (newReviewCount-1)) + payload.score) / newReviewCount;

                    transaction.update(toiletRef, { review_count: newReviewCount, avgScore: newAvgScore });
                    transaction.set(reviewRef, payload);
                });
            } catch (e) {
                console.error("Transaction failed: ", e);
                alert("Failed to submit review");
            }

            ev.target.reset();
        });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, function (m) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m];
  });
}
