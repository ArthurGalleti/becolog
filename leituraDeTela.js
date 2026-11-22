
const synth = window.speechSynthesis;

let leituraAtiva = false;
let ultimaLeitura = "";
let ultimoElemento = null;

const botaoLeitura = document.getElementById("speech-toggle");

// Elementos que podem ser lidos
const seletoresLeitura = [
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
    "button",
    "a",
    "label",
    "li",
    "td",
    "th",
    "[aria-label]",
    "[role='button']",
    ".stat-card",
    ".delivery-item"
].join(",");

// Obtém o texto do elemento
function obterTexto(elemento) {
    if (!elemento) return "";

    // Prioriza o texto acessível
    if (elemento.getAttribute("aria-label")) {
        return elemento.getAttribute("aria-label").trim();
    }

    // Para campos de formulário, procura o rótulo
    if (elemento.matches("input, textarea, select")) {
        const label = document.querySelector(
            `label[for="${elemento.id}"]`
        );

        return label
            ? label.innerText.trim()
            : elemento.placeholder || "";
    }

    return (
        elemento.innerText ||
        elemento.alt ||
        elemento.title ||
        ""
    ).trim();
}

// Realiza a leitura
function falarTexto(texto) {
    if (!leituraAtiva || !synth || !texto.trim()) return;

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(texto);

    utterance.lang = "pt-BR";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    synth.speak(utterance);
}

// Identifica o elemento que deve ser lido
function identificarElemento(alvo) {
    if (!(alvo instanceof Element)) return null;

    return alvo.closest(seletoresLeitura);
}

// Leitura ao passar o mouse
document.body.addEventListener("mouseover", (event) => {
    if (!leituraAtiva) return;

    const elemento = identificarElemento(event.target);

    if (!elemento) return;

    if (elemento === ultimoElemento) return;

    ultimoElemento = elemento;

    const texto = obterTexto(elemento);

    if (texto && texto !== ultimaLeitura) {
        ultimaLeitura = texto;
        falarTexto(texto);
    }
});

// Leitura ao navegar com teclado
document.body.addEventListener("focusin", (event) => {
    if (!leituraAtiva) return;

    const elemento = identificarElemento(event.target);

    if (!elemento) return;

    const texto = obterTexto(elemento);

    if (texto) {
        ultimoElemento = elemento;
        ultimaLeitura = texto;
        falarTexto(texto);
    }
});

// Ativar e desativar a leitura
if (botaoLeitura) {
    botaoLeitura.addEventListener("click", () => {
        leituraAtiva = !leituraAtiva;

        botaoLeitura.setAttribute(
            "aria-pressed",
            String(leituraAtiva)
        );

        if (leituraAtiva) {
            botaoLeitura.textContent = "🔇 Desativar leitura";
            botaoLeitura.classList.add("active");
            botaoLeitura.setAttribute(
                "aria-label",
                "Desativar leitura de tela"
            );

            ultimaLeitura = "";
            ultimoElemento = null;
        } else {
            botaoLeitura.textContent = "🔊 Ativar leitura";
            botaoLeitura.classList.remove("active");
            botaoLeitura.setAttribute(
                "aria-label",
                "Ativar leitura de tela"
            );

            synth.cancel();

            ultimaLeitura = "";
            ultimoElemento = null;
        }
    });
}

// Interrompe a fala quando a página perde visibilidade
document.addEventListener("visibilitychange", () => {
    if (document.hidden && synth) {
        synth.cancel();
    }
});
