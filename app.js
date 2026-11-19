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

    const oldVideoTrack = localStream.getVideoTracks()[0];
    if (oldVideoTrack) {
      localStream.removeTrack(oldVideoTrack);
      oldVideoTrack.stop();
    }

    localStream.addTrack(newVideoTrack);
    localVideo.srcObject = localStream;

    const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && newVideoTrack) {
      await sender.replaceTrack(newVideoTrack);
    }

    currentFacingMode = nextFacingMode;
    toggleCamBtn.textContent = "Camera Off";
    callStatus.textContent = nextFacingMode === "environment" ? "பின் கேமரா (Back)" : "முன் கேமரா (Front)";
  } catch (error) {
    callStatus.textContent = "கேமரா மாற்ற முடியவில்லை: " + error.message;
  }
});
