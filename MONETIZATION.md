# Reklam, mağaza ve mobil kontroller

## Bu değişiklikte çalışanlar

- Ana menü ve profil: Ayarlar paneli, Mağaza paneli.
- Ses efektleri seviyesi oyun içindeki ses çubuğuyla senkronize ve kalıcıdır.
- Titreşim anahtarı native düğmelerde Capacitor Haptics kullanır. Web'de pasiftir.
- Hareketi azalt tercihi menü/açılış hareketlerini kapatır. Sistem tercihi de korunur.
- Android geri: açılışı atla → en üst paneli kapat → mevcut uyarıyı kapat → maç/oda çıkış onayı → alt sayfadan ana menü → uygulamayı kapatma onayı.
- AdMob geçiş reklamı yalnızca bitmiş maçtan ana menüye dönerken değerlendirilir. En az 3 bitmiş maç ve reklamlar arasında en az 3 dakika. İlk açılışta, hamle sırasında ve rövanş başlatırken reklam yoktur. Sayaç aynı maçın tekrar yüklenmesini saymaz.
- Reklam yükleme 5 saniyede tamamlanmazsa atlanır. Geç gelen yükleme başka ekranın üstüne reklam açamaz. UMP izin vermedikçe reklam talep edilmez. Reklam sesi ses ayarını izler.
- Reklam tercihleri panelden yeniden açılabilir; bölge/AdMob yapılandırmasına göre UMP seçenek sunmayabilir.
- Tek ürün: `quoridor_remove_ads`, tek seferlik/non-consumable. RevenueCat `remove_ads` entitlement'ı ürünün sahibini belirler. İptal, bekleyen ödeme, hata, geri yükleme, iade sonrası entitlement güncellemesi ve çift dokunma ele alınır. Yerel bir boolean ile satın alma verilmez.
- Satın alma hakkı platform mağaza hesabına bağlıdır; bu sürüm Firebase hesabıyla platformlar arası hak aktarmaz. Yeniden kurulumda aynı mağaza hesabıyla geri yükle kullanılır.

## Mevcut durum

Native projeler Google'ın **demo** AdMob application ID'lerini kullanır. Reklam birimleri de varsayılan olarak Google demo ID'leridir. Gerçek reklam geliri oluşturmaz.
RevenueCat anahtarları verilmemiştir; mağaza açıkça "Satın alma henüz kullanıma açılmadı" gösterir. Web sürümünde satın alma/restore pasiftir, yerel reklam SDK'sı çağrılmaz. Fiyat elle yazılmaz; ürün açıldığında mağazanın yerelleştirilmiş fiyatı gösterilir.

## Hesaplar hazır olduğunda

1. Play Console / App Store Connect'te `quoridor_remove_ads` ürününü oluştur: bir kerelik, tüketilmeyen ürün. Her platformda fiyatı ve mağaza metinlerini tanımla.
2. RevenueCat'te Android/iOS uygulamalarını ve mağaza bağlantılarını yapılandır, ürünü `remove_ads` entitlement'ına bağla. Public platform SDK anahtarlarını `.env.example` üzerinden `.env.local` içine yaz. Secret API anahtarı veya mağaza özel anahtarı VITE değişkenlerine konmaz.
3. RevenueCat ve mağaza sandbox/test hesaplarıyla satın alma, iptal, bekleyen ödeme, geri yükleme, yeniden kurulum ve iade senaryolarını gerçek native derlemede dene.
4. AdMob Android/iOS uygulamalarını oluştur, interstitial birimlerini tanımla, UMP gizlilik mesajlarını yapılandır. Android `res/values/strings.xml` içindeki `admob_app_id` ve iOS `Info.plist` içindeki `GADApplicationIdentifier` demo değerlerini gerçek **application ID**'leriyle değiştir. VITE_ADMOB_* değişkenlerine ayrı **ad unit ID**'lerini yaz.
5. Varsayılan talepler `npa: true` (kişiselleştirilmemiş). Kod ATT izni istemez. AdMob panelinde IDFA/ATT kullanımını açmadan önce iOS izin açıklamasını, uygulamanın veri beyanını ve gerçek davranışını birlikte güncelle. Yayın öncesi Google'ın güncel SKAdNetwork listesini iOS yapılandırmasına ekle (şu an Google ID'si bulunur).
6. Test cihazında doğrulama tamamlandığında `VITE_ADS_MODE=live` ile yeniden derle ve `npm run cap:sync` çalıştır. Live modda satın alma hakkı doğrulanamazsa reklam gösterilmez. Mağazası yapılandırılmamış uygulamayla live reklam açılmaz.
7. Mağaza veri/gizlilik ve reklam beyanlarını kullanılan AdMob/RevenueCat SDK'larına göre tamamla. Bu PR mağaza hesapları, finansal sözleşme, fiyat veya canlı ürün oluşturmaz.

## Doğrulama

`npm test`, `npm run build`, `npx cap sync`.
Bunlar native SDK derlemesi veya gerçek ödeme/reklam testi değildir. Android Studio/Xcode ile native paket derleme ve gerçek cihaz/sandbox doğrulaması yayın öncesinde gerekir. Tarayıcı önizlemesi ortamda engellendiğinden görsel inceleme ayrıca yapılmalıdır.

Kaynaklar: [AdMob Capacitor](https://github.com/capacitor-community/admob), [RevenueCat Capacitor](https://github.com/RevenueCat/purchases-capacitor), [Google iOS kurulum](https://developers.google.com/admob/ios/quick-start).
