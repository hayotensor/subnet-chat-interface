var curModel = defaultModel;
const falconModel = "tiiuae/falcon-180B-chat";

function getConfig() {
  return modelConfigs[curModel];
}

var ws = null;
var position = 0;
const initialSessionLength = 512;
var sessionLength = initialSessionLength;
var connFailureBefore = false;

var totalElapsed, tokenCount;
let forceStop = false;
let waitingForInput = true;

function openSession() {
  let protocol = location.protocol == "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/api/v2/generate`);
  ws.onopen = () => {
    ws.send(JSON.stringify({type: "open_inference_session", model: curModel, max_length: sessionLength}));
    ws.onmessage = event => {
      const response = JSON.parse(event.data);
      if (!response.ok) {
        handleFailure(response.traceback);
        return;
      }
      console.log("openSession")
      sendReplica();
    };
  };

  ws.onerror = _event => handleFailure(`Connection failed`);
  ws.onclose = _event => {
    if ($(".error-box").is(":hidden")) {
      handleFailure(`Connection was closed`, true);
    }
  };
}

function resetSession() {
  console.log("resetSession")
  if (ws !== null && ws.readyState <= 1) {  // If readyState is "connecting" or "opened"
    ws.close();
  }
  ws = null;
  position = 0;
}

function isWaitingForInputs() {
  console.log("isWaitingForInputs")
  console.log('isWaitingForInputs bool', $('.human-replica textarea').length >= 1)
  const classNames = $("#ready").attr("class");
  console.log('isWaitingForInputs classNames', classNames)


  // return $('.human-replica textarea').length >= 1;
  return classNames == "ready"
  // return waitingForInput;
}

function sendReplica() {
  console.log("sendReplica")
  if (isWaitingForInputs()) {
    const aiPrompt = "Assistant:";
    // const value = document.getElementById("human-input-text").value;
    // $('.human-replica:last').text(value);
    $("#ready").attr('class', '');

    $('.dialogue').append($(
      `<p class="ai-human">${$('.human-replica:last textarea').val()}</p>`
    ))

    // $('.human-replica:last').text($('.human-replica:last textarea').val());


    $('.dialogue').append($(
      '<p class="ai-replica">' +
        `<span class="text">${aiPrompt}</span>` +
        '<span class="loading-animation"></span>' +
        '<span class="speed" style="display: none;"></span>' +
        '<span class="generation-controls"><a class="stop-generation" href=#>stop generation</a></span>' +
        '<span class="suggest-join" style="display: none;">' +
          '<b>Too slow?</b> ' +
          '<a target="_blank" href="https://github.com/bigscience-workshop/petals#connect-your-gpu-and-increase-petals-capacity">Connect your GPU</a> ' +
          'and increase Petals capacity!' +
        '</span>' +
      '</p>'));
    animateLoading();
    $('.stop-generation').click(e => {
      e.preventDefault();
      console.log("Stop generation");
      forceStop = true;
    });
  } else {
    $('.loading-animation').show();
  }

  if (ws === null) {
    openSession();
    return;
  }

  const replicaDivs = $('.ai-human, .ai-replica .text');
  // const replicaDivs = $('.human-replica, .ai-replica .text, #human-input-text');
  console.log("replicaDivs: ", replicaDivs);
  var replicas = [];
  for (var i = position; i < replicaDivs.length; i++) {
    const el = $(replicaDivs[i]);
    let phrase = el.text();
    console.log("phrase: ", phrase)
    if (curModel === falconModel) {
      if (i < 2) {
        // Skip the system prompt and the 1st assistant's message to match the HF demo format precisely
        continue;
      }
      phrase = phrase.replace(/^Human:/, 'User:');
      phrase = phrase.replace(/^Assistant:/, 'Falcon:');
    }
    if (el.is(".ai-human")) {
      console.log("replicas if human-replica: ", getConfig().chat.sep_token)
      phrase += getConfig().chat.sep_token;
    } else if (i < replicaDivs.length - 1) {
      console.log("replicas else is -1: ", getConfig().chat.stop_token)
      phrase += getConfig().chat.stop_token;
    }
    replicas.push(phrase);
  }
  console.log("replicas: ", replicas)
  const inputs = replicas.join("");
  position = replicaDivs.length;

  totalElapsed = 0;
  tokenCount = 0;
  receiveReplica(inputs);
}

function receiveReplica(inputs) {
  waitingForInput = true;

  console.log("receiveReplica inputs", inputs)
  ws.send(JSON.stringify({
    type: "generate",
    inputs: inputs,
    max_new_tokens: 1,
    stop_sequence: getConfig().chat.stop_token,
    extra_stop_sequences: getConfig().chat.extra_stop_sequences,
    ...getConfig().chat.generation_params,
  }));

  var lastMessageTime = null;
  ws.onmessage = event => {
    connFailureBefore = false;  // We've managed to connect after a possible failure

    waitingForInput = false;

    const response = JSON.parse(event.data);
    if (!response.ok) {
      handleFailure(response.traceback);
      return;
    }

    console.log("response: ", response)

    if (lastMessageTime != null) {
      totalElapsed += performance.now() - lastMessageTime;
      tokenCount += response.token_count;
    }
    lastMessageTime = performance.now();

    const lastReplica = $('.ai-replica .text').last();
    console.log("lastReplica: ", lastReplica)
    var newText = lastReplica.text() + response.outputs;
    if (curModel !== falconModel) {
      newText = newText.replace(getConfig().chat.stop_token, "");
    }
    if (getConfig().chat.extra_stop_sequences !== null) {
      for (const seq of getConfig().chat.extra_stop_sequences) {
        newText = newText.replace(seq, "");
      }
    }
    console.log("lastReplica newText: ", newText)
    lastReplica.text(newText);

    if (!response.stop && !forceStop) {
      if (tokenCount >= 1) {
        const speed = tokenCount / (totalElapsed / 1000);
        $('.speed')
          .text(`Speed: ${speed.toFixed(1)} tokens/sec`)
          .show();
        if (speed < 1) {
          $('.suggest-join').show();
        }
      }
    } else {
      if (forceStop) {
        resetSession();
        forceStop = false;
      }
      $('.loading-animation, .speed, .suggest-join, .generation-controls').remove();
      appendTextArea();
    }
  };
}

function handleFailure(message, autoRetry = false) {
  console.log("handleFailure")
  resetSession();
  if (!isWaitingForInputs()) {
    // Show the error and the retry button only if a user is waiting for the generation results

    if (message === "Connection failed" && !connFailureBefore) {
      autoRetry = true;
      connFailureBefore = true;
    }
    if (/Session .+ expired/.test(message)) {
      autoRetry = true;
    }
    const maxSessionLength = getConfig().chat.max_session_length;
    if (/Maximum length exceeded/.test(message) && sessionLength < maxSessionLength) {
      // We gradually increase sessionLength to save server resources. Default: 512 -> 2048 -> 8192 (if supported)
      sessionLength = Math.min(sessionLength * 4, maxSessionLength);
      autoRetry = true;
    }

    if (autoRetry) {
      retry();
    } else {
      $('.loading-animation').hide();
      if (/attention cache is full/.test(message)) {
        $('.error-message').hide();
        $('.out-of-capacity').show();
      } else {
        $('.out-of-capacity').hide();
        $('.error-message').text(message).show();
      }
      $('.error-box').show();
    }
  }
}

function retry() {
  console.log("retry")
  $('.error-box').hide();
  sendReplica();
}

function appendTextArea() {
  // console.log("appendTextArea")
  // const humanPrompt = "Human: ";
  // $('.dialogue').append($(
  //   `<p class="human-replica"><textarea class="form-control" id="exampleTextarea" rows="2">${humanPrompt}</textarea></p>`
  // ));
  upgradeTextArea();
}

// function upgradeTextArea() {
//   const textarea = $('.human-replica textarea');
//   autosize(textarea);
//   textarea[0].selectionStart = textarea[0].value.length;
//   textarea.focus();

//   textarea.on('keypress', e => {
//     if (e.which == 13 && !e.shiftKey) {
//       e.preventDefault();
//       console.log("keypress upgradeTextArea");
//       sendReplica();
//     }
//   });
// }

// function upgradeTextArea() {
//   const textarea = $('.human-replica textarea');
//   autosize(textarea);
//   textarea[0].selectionStart = textarea[0].value.length;
//   textarea.focus();

//   const textarea1 = $('#human-input-text');
//   textarea1[0].selectionStart = textarea[0].value.length;
//   textarea1.focus();

//   textarea.on('keypress', e => {
//     if (e.which == 13 && !e.shiftKey) {
//       e.preventDefault();
//       const value = document.getElementById("human-input-text").value;
//       // $('.human-replica:last').text(value);

//       $('.human-replica:last textarea').text(value)
//       console.log("keypress upgradeTextArea");
//       sendReplica();
//     }
//   });
// }

function upgradeTextArea() {
  $("#ready").attr('class', 'ready');

  const classNames = $("#ready").attr("class");
  console.log('upgradeTextArea classNames', classNames)

  const textarea = $('.human-replica textarea');
  autosize(textarea);
  textarea[0].selectionStart = textarea[0].value.length;
  textarea.focus();

  // const textarea1 = $('#human-input-text');
  // textarea1[0].selectionStart = textarea[0].value.length;
  // textarea1.focus();

  textarea.on('keypress', e => {
    if (e.which == 13 && !e.shiftKey) {
      e.preventDefault();
      // const value = document.getElementById("human-input-text").value;

      // $('.human-replica:last textarea').text(value)
      // console.log("keypress upgradeTextArea");
      sendReplica();
    }
  });
}

const animFrames = ["⌛", "🧠"];
var curFrame = 0;

function animateLoading() {
  $('.loading-animation').html(' &nbsp;' + animFrames[curFrame]);
  curFrame = (curFrame + 1) % animFrames.length;
}

$(() => {
  console.log("starting")
  upgradeTextArea();

  $('.family-selector label').click(function (e) {
    if (!isWaitingForInputs()) {
      alert("Can't switch the model while the AI is writing a response. Please refresh the page");
      e.preventDefault();
      return;
    }

    const radio = $(`#${$(this).attr("for")}`);
    if (radio.is(":checked")) {
      console.log("timeout human replica")
      setTimeout(() => $('.human-replica textarea').focus(), 10);
      return;
    }

    const curFamily = radio.attr("value");
    $('.model-selector').hide();
    const firstLabel = $(`.model-selector[data-family=${curFamily}]`).show().children('label:first');
    firstLabel.click();
    firstLabel.trigger('click');
  });
  $('.model-selector label').click(function (e) {
    if (!isWaitingForInputs()) {
      alert("Can't switch the model while the AI is writing a response. Please refresh the page");
      e.preventDefault();
      return;
    }

    curModel = $(`#${$(this).attr("for")}`).attr("value");
    $('.dialogue p').slice(2).remove();

    sessionLength = initialSessionLength;
    resetSession();
    appendTextArea();

    $('.model-name')
      .text($(this).text())
      .attr('href', getConfig().frontend.model_card);
    $('.license-link').attr('href', getConfig().frontend.license);
    setTimeout(() => $('.human-replica textarea').focus(), 10);
  });
  $('.retry-link').click(e => {
    e.preventDefault();
    retry();
  });

  setInterval(animateLoading, 2000);
});
