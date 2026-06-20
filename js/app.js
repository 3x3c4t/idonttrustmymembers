const elements = document.querySelectorAll(".card,.terminal,.beta,.security,.doc-card")

const observer = new IntersectionObserver(entries=>{
entries.forEach(e=>{
if(e.isIntersecting){
e.target.classList.add("show")
}
})
})

elements.forEach(el=>{
el.classList.add("reveal")
observer.observe(el)
})

const glow = document.querySelector(".glow")

let x = 0, y = 0
let tx = 0, ty = 0

document.addEventListener("mousemove", e=>{
tx = e.clientX
ty = e.clientY
})

function animate(){
x += (tx - x) * 0.10
y += (ty - y) * 0.10

glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`

requestAnimationFrame(animate)
}

animate()