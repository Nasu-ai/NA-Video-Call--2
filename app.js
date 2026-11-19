import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  onSnapshot,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDdiqVluh-0ZGgvX_needNg0kOdRC3C7Sw",
  authDomain: "na-video-call.firebaseapp.com",
  projectId: "na-video-call",
  storageBucket: "na-video-call.firebasestorage.app",
  messagingSenderId: "441876256888",
  appId: "1:441876256888:web:d3c6ba76eca9973a69b58d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const rtcConfig = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ]
};

const authSection = document.getElementById("auth-section");
const roomSection = document.getElementById("room-section");
const callSection = document.getElementById("call-section");

const loginTab = document.getElementById("login-tab");
const signupTab = document.getElementById("signup-tab");
const authForm = document.getElementById("auth-form");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authMessage = document.getElementById("auth-message");

const currentUserEmail = document.getElementById("current-user-email");
const logoutBtn = document.getElementById("logout-btn");
const createRoomBtn = document.getElementById("create-room-btn");
const createdRoomInfo = document.getElementById("created-room-info");
const createdRoomIdText = document.getElementById("created-room-id");
const copyRoomBtn = document.getElementById("copy-room-btn");
const joinRoomInput = document.getElementById("join-room-input");
const joinRoomBtn = document.getElementById("join-room-btn");
const roomMessage = document.getElementById("room-message");

const activeRoomIdText = document.getElementById("active-room-id");
const callStatus = document.getElementById("call-status");
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const toggleMicBtn = document.getElementById("toggle-mic-btn");
const toggleCamBtn = document.getElementById("toggle-cam-btn");
const switchCamBtn = document.getElementById("switch-cam-btn");
const hangupBtn = document.getElementById("hangup-btn");

const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

let isSignupMode = false;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentRoomId = null;
let currentFacingMode = "user"; // "user" = முன் கேமரா, "environment" = பின் கேமரா
let unsubscribers = [];

loginTab.addEventListener("click", () => {
  isSignupMode = false;
  loginTab.classList.add("active");
  signupTab.classList.remove("active");
  authSubmitBtn.textContent = "Login";
  authMessage.textContent = "";
});

signupTab.addEventListener("click", () => {
  isSignupMode = true;
  signupTab.classList.add("active");
  loginTab.classList.remove("active");
  authSubmitBtn.textContent = "Signup";
  authMessage.textContent = "";
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  authMessage.textContent = "செயல்படுகிறது...";
  try {
    if (isSignupMode) {
      await createUserWithEmailAndPassword(auth, email, password);
      authMessage.textContent = "கணக்கு உருவாக்கப்பட்டது!";
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      authMessage.textContent = "உள்நுழைவு வெற்றி!";
    }
  } catch (error) {
    authMessage.textContent = "பிழை: " + error.message;
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    authSection.classList.add("hidden");
    roomSection.classList.remove("hidden");
    callSection.classList.add("hidden");
    currentUserEmail.textContent = user.email;
  } else {
    authSection.classList.remove("hidden");
    roomSection.classList.add("hidden");
    callSection.classList.add("hidden");
    currentUserEmail.textContent = "";
  }
});

logoutBtn.addEventListener("click", async () => {
  await cleanupCall();
  await signOut(auth);
});

async function startMedia(facingMode = "user") {
  currentFacingMode = facingMode;
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: currentFacingMode },
    audio: true
  });
  remoteStream = new MediaStream();

  localVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;
  toggleMicBtn.textContent = "Mic Off";
  toggleCamBtn.textContent = "Camera Off";
}

// முன் / பின் கேமரா மாற்றும் வசதி (Switch Camera)
switchCamBtn.addEventListener("click", async () => {
  if (!localStream || !peerConnection) return;

  const nextFacingMode = currentFacingMode === "user" ? "environment" : "user";
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: nextFacingMode },
      audio: false
    });
    const newVideoTrack = newStream.getVideoTracks()[0];

    const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && newVideoTrack) {
      await sender.replaceTrack(newVideoTrack);
    }

    const oldVideoTrack = localStream.getVideoTracks()[0];
    if (oldVideoTrack) {
      oldVideoTrack.stop();
      localStream.removeTrack(oldVideoTrack);
    }

    localStream.addTrack(newVideoTrack);
    localVideo.srcObject = localStream;
    currentFacingMode = nextFacingMode;
    toggleCamBtn.textContent = "Camera Off";
    callStatus.textContent = nextFacingMode === "environment" ? "பின் கேமரா (Back)" : "முன் கேமரா (Front)";
  } catch (error) {
    callStatus.textContent = "கேமரா மாற்ற முடியவில்லை: " + error.message;
  }
});

// அறை குறுஞ்செய்திகளைக் கேட்கும் Listener (Real-Time Chat)
function listenToChat(roomId) {
  chatMessagesEl.innerHTML = "";
  const messagesCol = collection(db, "rooms", roomId, "messages");
  const q = query(messagesCol, orderBy("createdAt", "asc"));

  const unsubChat = onSnapshot(q, (snapshot) => {
    chatMessagesEl.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const msg = docSnap.data();
      const div = document.createElement("div");
      const isOwn = auth.currentUser && msg.senderId === auth.currentUser.uid;
      div.className = isOwn ? "chat-msg own" : "chat-msg";

      const senderSpan = document.createElement("span");
      senderSpan.className = "chat-sender";
      senderSpan.textContent = isOwn ? "நீங்கள்" : (msg.senderEmail || "பயனர்");

      const textNode = document.createTextNode(msg.text || "");
      div.appendChild(senderSpan);
      div.appendChild(textNode);
      chatMessagesEl.appendChild(div);
    });
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });

  unsubscribers.push(unsubChat);
}

// குறுஞ்செய்தி அனுப்புதல்
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !currentRoomId || !auth.currentUser) return;

  chatInput.value = "";
  try {
    const messagesCol = collection(db, "rooms", currentRoomId, "messages");
    await addDoc(messagesCol, {
      text,
      senderId: auth.currentUser.uid,
      senderEmail: auth.currentUser.email,
      createdAt: Date.now()
    });
  } catch (error) {
    callStatus.textContent = "செய்தி அனுப்ப முடியவில்லை: " + error.message;
  }
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

createRoomBtn.addEventListener("click", async () => {
  roomMessage.textContent = "கேமரா மற்றும் மைக் அனுமதி கேட்கப்படுகிறது...";
  try {
    await startMedia("user");

    const roomId = generateRoomId();
    currentRoomId = roomId;
    const roomRef = doc(db, "rooms", roomId);
    const callerCandidatesCol = collection(roomRef, "callerCandidates");
    const calleeCandidatesCol = collection(roomRef, "calleeCandidates");

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      callStatus.textContent = "இணைக்கப்பட்டது!";
    };

    peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        await addDoc(callerCandidatesCol, event.candidate.toJSON());
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await setDoc(roomRef, {
      offer: {
        type: offer.type,
        sdp: offer.sdp
      },
      createdBy: auth.currentUser.uid,
      createdAt: Date.now()
    });

    createdRoomIdText.textContent = roomId;
    createdRoomInfo.classList.remove("hidden");
    activeRoomIdText.textContent = roomId;
    callStatus.textContent = "மற்றவர் இணையக் காத்திருக்கிறது...";

    roomSection.classList.add("hidden");
    callSection.classList.remove("hidden");

    listenToChat(roomId);

    const unsubRoom = onSnapshot(roomRef, async (snapshot) => {
      const data = snapshot.data();
      if (!peerConnection.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(answerDescription);
      }
    });

    const unsubCallee = onSnapshot(calleeCandidatesCol, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          await peerConnection.addIceCandidate(candidate);
        }
      });
    });

    unsubscribers.push(unsubRoom, unsubCallee);
  } catch (error) {
    roomMessage.textContent = "பிழை: " + error.message;
  }
});

copyRoomBtn.addEventListener("click", async () => {
  const id = createdRoomIdText.textContent;
  await navigator.clipboard.writeText(id);
  copyRoomBtn.textContent = "Copied!";
  setTimeout(() => {
    copyRoomBtn.textContent = "Copy ID";
  }, 2000);
});

joinRoomBtn.addEventListener("click", async () => {
  const roomId = joinRoomInput.value.trim().toUpperCase();
  if (!roomId) {
    roomMessage.textContent = "தயவுசெய்து Room ID உள்ளிடவும்.";
    return;
  }

  roomMessage.textContent = "Room சரிபார்க்கப்படுகிறது...";
  try {
    const roomRef = doc(db, "rooms", roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists()) {
      roomMessage.textContent = "இந்த Room ID இல்லை. சரியான ID உள்ளிடவும்.";
      return;
    }

    await startMedia("user");
    currentRoomId = roomId;

    const callerCandidatesCol = collection(roomRef, "callerCandidates");
    const calleeCandidatesCol = collection(roomRef, "calleeCandidates");

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      callStatus.textContent = "இணைக்கப்பட்டது!";
    };

    peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        await addDoc(calleeCandidatesCol, event.candidate.toJSON());
      }
    };

    const offer = roomSnap.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await updateDoc(roomRef, {
      answer: {
        type: answer.type,
        sdp: answer.sdp
      }
    });

    const unsubCaller = onSnapshot(callerCandidatesCol, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          await peerConnection.addIceCandidate(candidate);
        }
      });
    });

    unsubscribers.push(unsubCaller);

    activeRoomIdText.textContent = roomId;
    callStatus.textContent = "இணைக்கப்பட்டது!";
    roomSection.classList.add("hidden");
    callSection.classList.remove("hidden");

    listenToChat(roomId);
  } catch (error) {
    roomMessage.textContent = "பிழை: " + error.message;
  }
});

toggleMicBtn.addEventListener("click", () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    toggleMicBtn.textContent = audioTrack.enabled ? "Mic Off" : "Mic On";
  }
});

toggleCamBtn.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    toggleCamBtn.textContent = videoTrack.enabled ? "Camera Off" : "Camera On";
  }
});

hangupBtn.addEventListener("click", async () => {
  await cleanupCall();
  callSection.classList.add("hidden");
  roomSection.classList.remove("hidden");
  roomMessage.textContent = "அழைப்பு துண்டிக்கப்பட்டது.";
});

async function cleanupCall() {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  chatMessagesEl.innerHTML = "";

  if (currentRoomId) {
    try {
      const roomRef = doc(db, "rooms", currentRoomId);

      const messageDocs = await getDocs(collection(roomRef, "messages"));
      for (const d of messageDocs.docs) await deleteDoc(d.ref);

      const callerDocs = await getDocs(collection(roomRef, "callerCandidates"));
      for (const d of callerDocs.docs) await deleteDoc(d.ref);

      const calleeDocs = await getDocs(collection(roomRef, "calleeCandidates"));
      for (const d of calleeDocs.docs) await deleteDoc(d.ref);

      await deleteDoc(roomRef);
    } catch (e) {
      // Room ஏற்கனவே நீக்கப்பட்டிருந்தால் பரவாயில்லை
    }
    currentRoomId = null;
  }
}
