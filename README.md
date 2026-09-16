# Quoridor

HTML/CSS/JavaScript + PixiJS oyun istemcisi. Vite web çıktısını, Capacitor iOS ve Android projelerini üretir.

## Geliştirme

Node.js 22.12+ gerekir.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Üç sayfa (`index.html`, `profile.html`, `howto.html`) birlikte derlenir. Kaynak dosyaları doğrudan statik sunucuya koymak yerine `dist/` yayımlanmalıdır. Göreli yollar alt dizin barındırmayı destekler.

Firebase SDK, PixiJS, Outfit ve Font Awesome npm üzerinden kilitli sürümlerle paketlenir. Sesler, simge ve PWA manifesti `dist/` içine kopyalanır. Web sürümünde ilk başarılı çevrimiçi yüklemeden sonra service worker tüm yerel kaynakları önbelleğe alır. Güncelleme, açık eski oyun oturumları kapandıktan sonra etkinleşir. Native sürümde kaynaklar uygulamaya gömülüdür ve service worker kaydedilmez. Çevrimiçi maç, profil ve Google girişi internet gerektirir.

## Mobil projeler

```sh
npm run cap:sync
npm run android
npm run ios
```

- `android/`: Android Studio projesi. Uyumlu Android SDK/JDK kurulumu gerekir.
- `ios/`: Xcode projesi (Swift Package Manager). Derleme ve imzalama macOS/Xcode gerektirir.
- Geçici uygulama kimliği: `com.burakgol.quoridor`. Mağaza kaydı ve imzalamadan önce kesinleştirin.
- Simge/açılış ekranları şu an Capacitor şablonudur; yayın tasarımları değildir.
- `dist/` ve platformlara kopyalanan web çıktıları sürüm kontrolünde tutulmaz. Her kaynak değişikliğinden sonra `npm run cap:sync` çalıştırın.

## Bu aşamadaki düzeltmeler

- Oda oluşturma kod çakışmalarında var olan odayı ezmez.
- Odaya katılım Firebase transaction kullanır; eşzamanlı katılımda ikinci oyuncu yalnızca bir kez atanır. Başarılı sunucu cevabından önce oyun açılmaz.
- Her yeni maçın `matchId` değeri vardır. Rövanşta her iki istemci sayaçlarını, istatistik kayıt bayrağını ve güçlendirme etkilerini temizler.
- Eşzamanlı rövanş istekleri başlayan yeni maçı tekrar sıfırlamaz.
- Native giriş köprüsünün uyumluluk gereksinimi nedeniyle Firebase SDK 12 sürümüne yükseltildi; tam sürümler npm kilit dosyasındadır.

## Yayın öncesinde kalan işler

Bu dal bir mobil temel oluşturur; mağaza yayınına hazır sürüm değildir.

- Sunucuda yetkili hamle/süre doğrulaması. Bu aşamada istemciler Firebase zaman referansını kullanır; backend hakemliği henüz yoktur.
- Oyuncu kimlikleri, sunucuda hamle/sonuç doğrulaması ve gözden geçirilmiş Firebase kuralları. Transaction kullanımı güvenlik doğrulamasının yerini tutmaz; oda kökünde gerekli okuma/yazma izinleri canlı ortamda doğrulanmalıdır.
- Native Google girişinin gerçek Firebase platform dosyaları ve OAuth ayarlarıyla etkinleştirilmesi; iOS için giriş seçeneklerinin değerlendirilmesi.
- Hesap silme, gizlilik metinleri, mağaza varlıkları ve native dokunsal geri bildirim.
- Fiziksel cihaz testleri, imzalı AAB/iOS arşivi ve mağaza başvuruları.

## İkinci aşama: saat ve maça dönüş

Çevrimiçi maçlarda `clock.remainingMs` ve `clock.startedAt` saklanır. İstemci `.info/serverTimeOffset` ile ortak zamanı tahmin eder; checkpoint başlangıcı Firebase `serverTimestamp()` ile işaretlenir. Sayaç arayüzü 250 ms aralıklarla kalan süreyi hesaplar. Arka planda sayaç callback'leri çalışmasa da geçen süre hesaba katılır. Hamleler matchId/revision kontrolüyle transaction içinde uygulanır; eski snapshot üzerine yazılmaz. Süresi biten oyuncunun geç gelen hamlesi uygulanmadan maç sonuçlandırılır. İki istemciden biri zaman aşımını sonuçlandırabilir; ikisi de kapalıysa sonraki bağlanışta sonuçlandırılır. Bu yapı sunucu taraflı bir oyun motoru veya hile koruması değildir; ağ gecikmesi/zaman tahmini toleransı vardır.

Bağlantı yokken yeni çevrimiçi hamleler engellenir. `localStorage` içinde 24 saat geçerli oda/koltuk kaydı saklanır. Aynı oda kodu başka bir oda için kullanılırsa `roomSessionId` ve koltuk kimliği eşleşmediği için eski kayıtla girilmez. Bu kimlikler yetkilendirme token'ı değildir; Firebase kuralları ve oyuncu UID doğrulaması hâlâ gereklidir. Web görünür olduğunda, native uygulama ön plana geldiğinde ve Firebase bağlantısı geri geldiğinde güncel oda alınır. Bilerek çıkış, maç bitişi veya AI moduna geçiş kayıtlı çevrimiçi oturumu temizler. Oturum saklama engelliyse oyun çalışır, yeniden açılışta geri dönüş yapılamaz. Bu sürümden önce oluşturulmuş odaları bitirip yeni oda açın; eski istemcilerle karışık çevrimiçi maç desteklenmez.

## Native Google girişini etkinleştirme

Web Google girişi popup kullanmaya devam eder. Native akış `@capacitor-firebase/authentication` ile alınan Google credential'ını Firebase JS oturumuna aktarır; `skipNativeAuth: true` ayarlıdır.

**Şu an native Google girişi etkin değildir.** `includePlugins` listesinde sadece `@capacitor/app` vardır. Firebase platform dosyaları yokken auth eklentisinin iOS başlangıcında `FirebaseApp.configure()` çağırıp uygulamayı kapatmasını önlemek için auth eklentisi native projeye henüz bağlanmaz. Kullanıcı yine AI/oda akışını kullanabilir.

Etkinleştirme için:

1. Firebase projesinde `com.burakgol.quoridor` kimliğiyle Android ve iOS uygulamalarını kaydedin. Android için `android/app/google-services.json`, iOS için `ios/App/App/GoogleService-Info.plist` dosyalarını sağlayın. iOS plist'ini Xcode App hedefine kaynak olarak ekleyin.
2. Google sağlayıcısını açın; Android debug/release/Play App Signing SHA-1 parmak izlerini Firebase'e ekleyin. iOS plist'indeki `REVERSED_CLIENT_ID` değerini Xcode URL Types alanına ekleyin. Bu değerler bu repoda uydurulmaz.
3. `capacitor.config.json` içindeki `includePlugins` listesine `@capacitor-firebase/authentication` ekleyin; `npm run cap:sync` çalıştırın. Google Android bağımlılık seçimi, iOS Google-only SwiftPM ayarları ve URL callback köprüsü hazırlanmıştır. Xcode 16.3+ / Swift 6.1+ gerekir.
4. Her iki platformda gerçek cihaz girişi, iptal, çıkış ve uygulama yeniden açılışında oturum kalıcılığını doğrulayın.

İlgili kaynaklar: [Firebase saat/bağlantı](https://firebase.google.com/docs/database/web/offline-capabilities), [Google native kurulum](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/setup-google.md).
