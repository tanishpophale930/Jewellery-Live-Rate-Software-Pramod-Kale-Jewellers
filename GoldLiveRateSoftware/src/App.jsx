import './App.css'
import GoldLiveRatesComponentOld from './Components/GoldLiveRatesComponentOld'
import GoldLiveRatesComponent from './Components/GoldLiveRatesComponent'


function App() {

  return (
    <>
      <GoldLiveRatesComponent 
        logoSrc="../prk.png"
        shopName = 'प्रमोद रामभाऊ काळे ज्वेलर्स' 
        shopImageSrc = "../प्रमोद रामभाऊ काळे ज्वेलर्स, पुलगांव.png"
        shopSalutation = "../Layer.png"
        defaultRefreshSeconds = {5}
      />      
    </>
  )
}


// function App() {

//   return (
//     <>
//       <GoldLiveRatesComponentOld 
//         logoSrc="../prk.png"
//         shopName = 'Pramod Jewellers' 
//         defaultRefreshSeconds = {60}
//       />      
//     </>
//   )
// }

export default App
